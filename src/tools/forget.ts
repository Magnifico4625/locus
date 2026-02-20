import type { SemanticMemory } from '../memory/semantic.js';
import type { ForgetResponse } from '../types.js';
import type { ConfirmationTokenStore } from './confirmation-token.js';

export interface ForgetDeps {
  semantic: SemanticMemory;
  tokenStore: ConfirmationTokenStore;
}

const BULK_DELETE_THRESHOLD = 5;

/**
 * Remove memory entries matching a search query from semantic memory.
 *
 * Flow:
 * 1. Search for matching entries (up to 100).
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
  const matches = deps.semantic.search(query, 100);
  const count = matches.length;

  if (count === 0) {
    return { status: 'deleted', deleted: 0, message: 'No matching entries found.' };
  }

  if (count <= BULK_DELETE_THRESHOLD) {
    for (const entry of matches) {
      deps.semantic.remove(entry.id);
    }
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

  for (const entry of matches) {
    deps.semantic.remove(entry.id);
  }
  return {
    status: 'deleted',
    deleted: count,
    message: `Deleted ${count} entries.`,
  };
}
