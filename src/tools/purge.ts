import { statSync } from 'node:fs';
import type { DatabaseAdapter, PurgeResponse } from '../types.js';
import type { ConfirmationTokenStore } from './confirmation-token.js';

export interface PurgeDeps {
  db: DatabaseAdapter;
  dbPath: string;
  projectPath: string;
  tokenStore: ConfirmationTokenStore;
}

interface CountRow {
  cnt: number;
}

function getDbSizeBytes(dbPath: string): number {
  try {
    return statSync(dbPath).size;
  } catch {
    return 0;
  }
}

/**
 * Purge all memory data for a project (Contract 9 — two-call confirmation pattern).
 *
 * Flow:
 * 1. NO TOKEN (first call):
 *    - Gather stats: file count, semantic count, episodic count, DB size.
 *    - Generate token via deps.tokenStore.generate().
 *    - Return PurgeResponsePending with stats and warning message.
 *
 * 2. WITH VALID TOKEN (second call):
 *    - deps.tokenStore.consume(token) → true.
 *    - DELETE FROM all data tables: files, memories, hook_captures, scan_state.
 *    - Return PurgeResponseDone.
 *
 * 3. INVALID/EXPIRED/REUSED TOKEN:
 *    - deps.tokenStore.consume(token) → false.
 *    - Return PurgeResponseError.
 */
export function handlePurge(deps: PurgeDeps, confirmToken?: string): PurgeResponse {
  if (confirmToken === undefined) {
    // First call — gather stats and return pending confirmation
    const fileRow = deps.db.get<CountRow>('SELECT COUNT(*) AS cnt FROM files');
    const files = fileRow?.cnt ?? 0;

    const memRow = deps.db.get<CountRow>(
      "SELECT COUNT(*) AS cnt FROM memories WHERE layer = 'semantic'",
    );
    const memories = memRow?.cnt ?? 0;

    const episodeRow = deps.db.get<CountRow>(
      "SELECT COUNT(*) AS cnt FROM memories WHERE layer = 'episodic'",
    );
    const episodes = episodeRow?.cnt ?? 0;

    const dbSizeBytes = getDbSizeBytes(deps.dbPath);

    const token = deps.tokenStore.generate();

    const message =
      `This will delete ALL memory for ${deps.projectPath}. ` +
      `${files} files, ${memories} decisions, ${episodes} episodes. ` +
      `This cannot be undone.`;

    return {
      status: 'pending_confirmation',
      confirmToken: token,
      message,
      stats: { files, memories, episodes, dbSizeBytes },
    };
  }

  // Second call — consume the token
  if (!deps.tokenStore.consume(confirmToken)) {
    return { status: 'error', message: 'Invalid or expired confirmation token.' };
  }

  // Token valid — wipe all data tables
  deps.db.run('DELETE FROM files');
  deps.db.run('DELETE FROM memories');
  deps.db.run('DELETE FROM hook_captures');
  deps.db.run('DELETE FROM scan_state');

  return {
    status: 'purged',
    message: `Deleted ${deps.dbPath}. Memory cleared.`,
    deletedDbPath: deps.dbPath,
  };
}
