import type { DatabaseAdapter } from '../types.js';

interface CompactParams {
  maxAgeDays?: number;
  keepSessions?: number;
}

interface CompactResult {
  deletedEntries: number;
  remainingEntries: number;
  remainingSessions: number;
}

export function handleCompact(db: DatabaseAdapter, params: CompactParams): CompactResult {
  const maxAgeDays = params.maxAgeDays ?? 30;
  const keepSessions = params.keepSessions ?? 5;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  // Find sessions to keep (most recent N by latest entry timestamp)
  const recentSessions =
    keepSessions > 0
      ? db.all<{ sid: string }>(
          `SELECT session_id AS sid FROM memories
           WHERE layer = 'episodic' AND session_id IS NOT NULL
           GROUP BY session_id
           ORDER BY MAX(created_at) DESC
           LIMIT ?`,
          [keepSessions],
        )
      : [];
  const keepSessionIds = recentSessions.map((r) => r.sid);

  // Delete old episodic entries NOT in kept sessions
  let deletedEntries = 0;
  if (keepSessionIds.length > 0) {
    const placeholders = keepSessionIds.map(() => '?').join(',');
    const result = db.run(
      `DELETE FROM memories
       WHERE layer = 'episodic'
         AND created_at < ?
         AND (session_id IS NULL OR session_id NOT IN (${placeholders}))`,
      [cutoff, ...keepSessionIds],
    );
    deletedEntries = result.changes;
  } else {
    const result = db.run(
      "DELETE FROM memories WHERE layer = 'episodic' AND created_at < ?",
      [cutoff],
    );
    deletedEntries = result.changes;
  }

  // Count remaining
  const remaining = db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM memories WHERE layer = 'episodic'",
  );
  const sessions = db.get<{ cnt: number }>(
    "SELECT COUNT(DISTINCT session_id) as cnt FROM memories WHERE layer = 'episodic' AND session_id IS NOT NULL",
  );

  return {
    deletedEntries,
    remainingEntries: remaining?.cnt ?? 0,
    remainingSessions: sessions?.cnt ?? 0,
  };
}
