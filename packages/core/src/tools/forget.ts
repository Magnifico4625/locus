import type { DurableMemoryStore } from '../memory/durable.js';
import type { SemanticMemory } from '../memory/semantic.js';
import type { ForgetResponse, ForgetTargetKind } from '../types.js';
import type { ConfirmationTokenStore } from './confirmation-token.js';

export interface ForgetDeps {
  semantic: SemanticMemory;
  tokenStore: ConfirmationTokenStore;
  durable?: DurableMemoryStore;
}

const BULK_DELETE_THRESHOLD = 5;

interface ForgetMatchSet {
  kind: ForgetTargetKind;
  count: number;
  deleteAll: () => void;
}

function parseDurableId(query: string): number | null {
  const match = /^durable:(\d+)$/i.exec(query.trim());
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function parseTopicKey(query: string): string | null {
  const match = /^topic:(.+)$/i.exec(query.trim());
  if (!match) {
    return null;
  }

  const topicKey = (match[1] ?? '').trim();
  return topicKey.length > 0 ? topicKey : null;
}

function resolveMatches(query: string, deps: ForgetDeps): ForgetMatchSet {
  const topicKey = parseTopicKey(query);
  const durable = deps.durable;
  if (topicKey !== null && durable) {
    const matches = durable.listByTopic(topicKey);
    return {
      kind: 'durable_topic',
      count: matches.length,
      deleteAll: () => {
        for (const entry of matches) {
          durable.removeById(entry.id);
        }
      },
    };
  }

  const matches = deps.semantic.search(query, 100);
  return {
    kind: 'semantic_query',
    count: matches.length,
    deleteAll: () => {
      for (const entry of matches) {
        deps.semantic.remove(entry.id);
      }
    },
  };
}

/**
 * Remove memory entries matching either:
 * - a plain semantic search query
 * - an explicit durable id target: durable:<id>
 * - an explicit durable topic target: topic:<topicKey>
 *
 * Flow:
 * 1. Resolve the target and matching entries.
 * 2. If 0 matches: return deleted=0 immediately.
 * 3. If <=5 matches: delete all, return deleted count.
 * 4. If >5 matches AND no confirmToken: generate a pending-confirmation token
 *    and return it with the match count so the caller can confirm.
 * 5. If >5 matches AND confirmToken provided:
 *    - If token invalid/expired: return error.
 *    - Else: consume token, delete all matches, return deleted count.
 */
export function handleForget(
  query: string,
  deps: ForgetDeps,
  confirmToken?: string,
): ForgetResponse {
  const durableId = parseDurableId(query);
  if (durableId !== null && deps.durable) {
    const deleted = deps.durable.removeById(durableId);
    return {
      status: 'deleted',
      deleted: deleted ? 1 : 0,
      message: deleted ? 'Deleted 1 entry.' : 'No matching entries found.',
    };
  }

  const matchSet = resolveMatches(query, deps);
  const count = matchSet.count;

  if (count === 0) {
    return { status: 'deleted', deleted: 0, message: 'No matching entries found.' };
  }

  if (count <= BULK_DELETE_THRESHOLD) {
    matchSet.deleteAll();
    return {
      status: 'deleted',
      deleted: count,
      message: `Deleted ${count} ${count === 1 ? 'entry' : 'entries'}.`,
    };
  }

  // count > BULK_DELETE_THRESHOLD — requires confirmation
  if (confirmToken === undefined) {
    const token = deps.tokenStore.generate();
    return {
      status: 'pending_confirmation',
      confirmToken: token,
      matches: count,
      message: `Found ${count} matching entries. Pass confirmToken="${token}" to confirm bulk deletion.`,
    };
  }

  // confirmToken provided — validate and consume
  if (!deps.tokenStore.consume(confirmToken)) {
    return { status: 'error', message: 'Invalid or expired confirmation token.' };
  }

  matchSet.deleteAll();
  return {
    status: 'deleted',
    deleted: count,
    message: `Deleted ${count} entries.`,
  };
}
