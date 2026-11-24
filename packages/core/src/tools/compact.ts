import { formatLocalDateKey, syncDailyJournal } from '../memory/daily-journal.js';
import { buildProjectScopeClause, normalizeProjectRootForScope } from '../recall/project-scope.js';
import type { DatabaseAdapter } from '../types.js';

export interface CompactParams {
  maxAgeDays?: number;
  keepSessions?: number;
  projectRoot?: string;
  journalDir?: string;
  compactToolEvents?: boolean;
}

export interface CompactResult {
  deletedEntries: number;
  remainingEntries: number;
  remainingSessions: number;
  deletedToolEvents: number;
  remainingConversationEvents: number;
  dailySummariesUpserted: number;
  walCheckpointed: boolean;
}

interface CandidateToolRow {
  id: number;
  event_id: string;
  project_root: string;
  timestamp: number;
}

function tableExists(db: DatabaseAdapter, name: string): boolean {
  const row = db.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return (row?.cnt ?? 0) > 0;
}

function chunkItems<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function handleCompact(db: DatabaseAdapter, params: CompactParams): CompactResult {
  const maxAgeDays = params.maxAgeDays ?? 30;
  const keepSessions = params.keepSessions ?? 5;
  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

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
    const result = db.run("DELETE FROM memories WHERE layer = 'episodic' AND created_at < ?", [
      cutoff,
    ]);
    deletedEntries = result.changes;
  }

  const remaining = db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM memories WHERE layer = 'episodic'",
  );
  const sessions = db.get<{ cnt: number }>(
    "SELECT COUNT(DISTINCT session_id) as cnt FROM memories WHERE layer = 'episodic' AND session_id IS NOT NULL",
  );

  // Compact old raw tool_use events in conversation_events after materializing daily summaries
  let deletedToolEvents = 0;
  let dailySummariesUpserted = 0;
  const scopedRoot = params.projectRoot
    ? normalizeProjectRootForScope(params.projectRoot)
    : undefined;
  const scope = scopedRoot ? buildProjectScopeClause('project_root', scopedRoot) : undefined;

  if (params.compactToolEvents !== false) {
    const scopeWhere = scope ? `AND ${scope.clause}` : '';
    const scopeParams = scope ? scope.params : [];

    const recentConvSessions =
      keepSessions > 0
        ? db
            .all<{ sid: string }>(
              `SELECT session_id AS sid
               FROM conversation_events
               WHERE session_id IS NOT NULL AND session_id != '' ${scopeWhere}
               GROUP BY session_id
               ORDER BY MAX(timestamp) DESC
               LIMIT ?`,
              [...scopeParams, keepSessions],
            )
            .map((row) => row.sid)
        : [];

    let toolRows: CandidateToolRow[];
    if (recentConvSessions.length > 0) {
      const placeholders = recentConvSessions.map(() => '?').join(',');
      toolRows = db.all<CandidateToolRow>(
        `SELECT id, event_id, project_root, timestamp
         FROM conversation_events
         WHERE kind = 'tool_use'
           AND timestamp < ?
           ${scopeWhere}
           AND (session_id IS NULL OR session_id NOT IN (${placeholders}))`,
        [cutoff, ...scopeParams, ...recentConvSessions],
      );
    } else {
      toolRows = db.all<CandidateToolRow>(
        `SELECT id, event_id, project_root, timestamp
         FROM conversation_events
         WHERE kind = 'tool_use'
           AND timestamp < ?
           ${scopeWhere}`,
        [cutoff, ...scopeParams],
      );
    }

    if (toolRows.length > 0) {
      const datesByProject = new Map<string, Set<string>>();
      for (const row of toolRows) {
        const root = row.project_root ? normalizeProjectRootForScope(row.project_root) : scopedRoot;
        if (!root) {
          continue;
        }
        let dateSet = datesByProject.get(root);
        if (!dateSet) {
          dateSet = new Set<string>();
          datesByProject.set(root, dateSet);
        }
        if (Number.isFinite(row.timestamp)) {
          dateSet.add(formatLocalDateKey(row.timestamp));
        }
      }

      if (tableExists(db, 'daily_summaries')) {
        for (const [root, dateSet] of datesByProject.entries()) {
          const syncResult = syncDailyJournal({
            db,
            projectRoot: root,
            ...(params.journalDir && scopedRoot === root ? { journalDir: params.journalDir } : {}),
            dateKeys: [...dateSet],
            now,
          });
          dailySummariesUpserted += syncResult.syncedDates.length;
        }
      }

      const hasConversationFts = tableExists(db, 'conversation_fts');
      const rowIds = toolRows.map((row) => row.id);
      const eventIds = toolRows.map((row) => row.event_id);

      for (const batch of chunkItems(eventIds, 400)) {
        const ph = batch.map(() => '?').join(',');
        db.run(`DELETE FROM event_files WHERE event_id IN (${ph})`, batch);
      }

      for (const batch of chunkItems(rowIds, 400)) {
        const ph = batch.map(() => '?').join(',');
        if (hasConversationFts) {
          db.run(`DELETE FROM conversation_fts WHERE rowid IN (${ph})`, batch);
        }
        const delResult = db.run(`DELETE FROM conversation_events WHERE id IN (${ph})`, batch);
        deletedToolEvents += delResult.changes;
      }
    }
  }

  const remainingConvRow = scope
    ? db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM conversation_events WHERE ${scope.clause}`,
        scope.params,
      )
    : db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events');

  let walCheckpointed = false;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    walCheckpointed = true;
  } catch {
    walCheckpointed = false;
  }

  return {
    deletedEntries,
    remainingEntries: remaining?.cnt ?? 0,
    remainingSessions: sessions?.cnt ?? 0,
    deletedToolEvents,
    remainingConversationEvents: remainingConvRow?.cnt ?? 0,
    dailySummariesUpserted,
    walCheckpointed,
  };
}
