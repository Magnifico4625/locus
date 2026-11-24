import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { dayBucket } from '../recall/calendar.js';
import { buildProjectScopeClause, normalizeProjectRootForScope } from '../recall/project-scope.js';
import type { DatabaseAdapter } from '../types.js';

export interface DailySummaryRow {
  projectRoot: string;
  dateKey: string;
  eventCount: number;
  sessionCount: number;
  decisionCount: number;
  summaryMd: string;
  updatedAt: number;
}

export interface SyncDailyJournalOptions {
  db: DatabaseAdapter;
  projectRoot: string;
  journalDir?: string;
  dateKeys?: readonly string[];
  now?: number;
}

export interface SyncDailyJournalResult {
  syncedDates: string[];
  journalFilesWritten: number;
}

interface DbDailySummaryRow {
  project_root: string;
  date_key: string;
  event_count: number;
  session_count: number;
  decision_count: number;
  summary_md: string;
  updated_at: number;
}

interface DurableDailyRow {
  id: number;
  memory_type: string;
  summary: string;
  updated_at: number;
}

interface EventDailyRow {
  session_id: string | null;
  kind: string;
  payload_json: string | null;
}

interface FileDailyRow {
  file_path: string;
}

const MAX_HIGHLIGHTS = 8;
const HIGHLIGHT_MAX_CHARS = 180;
const DURABLE_MAX_CHARS = 220;
const MAX_MODIFIED_FILES = 15;
const PREVIEW_MAX_CHARS = 100;

const HOOK_ECHO_PREFIXES = [
  'the following system message was injected by a preinvocation hook:',
  '[locus memory — project brief]',
  '[locus memory — relevant recall]',
];

export function formatLocalDateKey(timestampMs: number): string {
  return dayBucket(timestampMs, { mode: 'local' }).key;
}

export function resolveJournalDirFromDbPath(dbPath: string): string {
  return join(dirname(dbPath), 'journal');
}

export function extractDailyPreview(summaryMd: string): string | undefined {
  for (const line of summaryMd.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) {
      continue;
    }
    const clean = trimmed
      .slice(2)
      .replace(/^`([^`]+)`$/u, '$1')
      .trim();
    if (clean.length === 0) {
      continue;
    }
    return clean.length <= PREVIEW_MAX_CHARS
      ? clean
      : `${clean.slice(0, PREVIEW_MAX_CHARS - 3).trimEnd()}...`;
  }
  return undefined;
}

export function listRecentDailySummaries(
  db: DatabaseAdapter,
  projectRoot: string,
  limit = 3,
): DailySummaryRow[] {
  const safeLimit = Math.max(0, Math.trunc(limit));
  if (safeLimit === 0) {
    return [];
  }

  const scopedRoot = normalizeProjectRootForScope(projectRoot);
  try {
    const rows = db.all<DbDailySummaryRow>(
      `SELECT project_root, date_key, event_count, session_count, decision_count, summary_md, updated_at
       FROM daily_summaries
       WHERE project_root = ?
       ORDER BY date_key DESC
       LIMIT ?`,
      [scopedRoot, safeLimit],
    );
    return rows.map(toDailySummaryRow);
  } catch {
    return [];
  }
}

export function loadDailySummaryByDate(
  db: DatabaseAdapter,
  projectRoot: string,
  dateKey: string,
): DailySummaryRow | undefined {
  const scopedRoot = normalizeProjectRootForScope(projectRoot);
  try {
    const row = db.get<DbDailySummaryRow>(
      `SELECT project_root, date_key, event_count, session_count, decision_count, summary_md, updated_at
       FROM daily_summaries
       WHERE project_root = ? AND date_key = ?
       LIMIT 1`,
      [scopedRoot, dateKey],
    );
    return row ? toDailySummaryRow(row) : undefined;
  } catch {
    return undefined;
  }
}

export function syncDailyJournal(options: SyncDailyJournalOptions): SyncDailyJournalResult {
  const scopedRoot = normalizeProjectRootForScope(options.projectRoot);
  const now = options.now ?? Date.now();
  const projectName = basename(scopedRoot) || scopedRoot;
  const ceScope = buildProjectScopeClause('project_root', scopedRoot);
  const dmScope = buildProjectScopeClause('project_root', scopedRoot);
  const ceJoinedScope = buildProjectScopeClause('ce.project_root', scopedRoot);

  const dateKeys =
    options.dateKeys && options.dateKeys.length > 0
      ? [...new Set(options.dateKeys)].sort()
      : discoverProjectDateKeys(options.db, ceScope, dmScope);

  const syncedDates: string[] = [];
  let journalFilesWritten = 0;

  if (options.journalDir && dateKeys.length > 0) {
    mkdirSync(options.journalDir, { recursive: true });
  }

  for (const dateKey of dateKeys) {
    const bounds = parseLocalDateKeyBounds(dateKey);
    if (!bounds) {
      continue;
    }

    const durableRows = options.db.all<DurableDailyRow>(
      `SELECT id, memory_type, summary, updated_at
       FROM durable_memories
       WHERE state = 'active'
         AND ${dmScope.clause}
         AND ((updated_at >= ? AND updated_at < ?) OR (created_at >= ? AND created_at < ?))
       ORDER BY updated_at DESC, id DESC
       LIMIT 30`,
      [...dmScope.params, bounds.from, bounds.to, bounds.from, bounds.to],
    );

    const eventRows = options.db.all<EventDailyRow>(
      `SELECT session_id, kind, payload_json
       FROM conversation_events
       WHERE ${ceScope.clause}
         AND timestamp >= ?
         AND timestamp < ?
       ORDER BY timestamp ASC, id ASC`,
      [...ceScope.params, bounds.from, bounds.to],
    );

    if (eventRows.length === 0 && durableRows.length === 0) {
      continue;
    }

    const modifiedFiles = options.db
      .all<FileDailyRow>(
        `SELECT ef.file_path
         FROM event_files ef
         JOIN conversation_events ce ON ce.event_id = ef.event_id
         WHERE ${ceJoinedScope.clause}
           AND ce.timestamp >= ?
           AND ce.timestamp < ?
         GROUP BY ef.file_path
         ORDER BY COUNT(*) DESC, MAX(ce.timestamp) DESC
         LIMIT ?`,
        [...ceJoinedScope.params, bounds.from, bounds.to, MAX_MODIFIED_FILES],
      )
      .map((row) => row.file_path);

    const sessions = new Set<string>();
    const highlights: string[] = [];
    const seenHighlights = new Set<string>();

    for (const row of eventRows) {
      if (row.session_id && row.session_id.trim().length > 0) {
        sessions.add(row.session_id);
      }

      if (highlights.length >= MAX_HIGHLIGHTS) {
        continue;
      }

      const text = extractHighlightText(row.kind, row.payload_json);
      if (!text) {
        continue;
      }

      const key = text.toLowerCase();
      if (seenHighlights.has(key)) {
        continue;
      }
      seenHighlights.add(key);
      highlights.push(text);
    }

    const decisionCount = durableRows.filter((row) => row.memory_type === 'decision').length;
    const summaryMd = buildDailyMarkdown({
      dateKey,
      projectName,
      eventCount: eventRows.length,
      sessionCount: sessions.size,
      decisionCount,
      durableRows,
      modifiedFiles,
      highlights,
    });

    options.db.run(
      `INSERT INTO daily_summaries (
         project_root, date_key, event_count, session_count, decision_count, summary_md, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_root, date_key) DO UPDATE SET
         event_count = excluded.event_count,
         session_count = excluded.session_count,
         decision_count = excluded.decision_count,
         summary_md = excluded.summary_md,
         updated_at = excluded.updated_at`,
      [scopedRoot, dateKey, eventRows.length, sessions.size, decisionCount, summaryMd, now],
    );

    syncedDates.push(dateKey);

    if (options.journalDir) {
      atomicWriteText(join(options.journalDir, `${dateKey}.md`), `${summaryMd}\n`);
      journalFilesWritten++;
    }
  }

  if (options.journalDir && syncedDates.length > 0) {
    const allDays = listRecentDailySummaries(options.db, scopedRoot, 3650);
    if (allDays.length > 0) {
      const indexLines = [
        `# Locus Memory Journal — ${projectName}`,
        '',
        ...allDays.map(
          (day) =>
            `- [${day.dateKey}](./${day.dateKey}.md) — ${day.decisionCount} decisions, ${day.eventCount} events, ${day.sessionCount} sessions`,
        ),
      ];
      atomicWriteText(join(options.journalDir, 'INDEX.md'), `${indexLines.join('\n')}\n`);
      journalFilesWritten++;
    }
  }

  return { syncedDates, journalFilesWritten };
}

function toDailySummaryRow(row: DbDailySummaryRow): DailySummaryRow {
  return {
    projectRoot: row.project_root,
    dateKey: row.date_key,
    eventCount: row.event_count,
    sessionCount: row.session_count,
    decisionCount: row.decision_count,
    summaryMd: row.summary_md,
    updatedAt: row.updated_at,
  };
}

function discoverProjectDateKeys(
  db: DatabaseAdapter,
  ceScope: { clause: string; params: string[] },
  dmScope: { clause: string; params: string[] },
): string[] {
  const keys = new Set<string>();

  const ceRows = db.all<{ timestamp: number }>(
    `SELECT timestamp FROM conversation_events WHERE ${ceScope.clause}`,
    ceScope.params,
  );
  for (const row of ceRows) {
    if (Number.isFinite(row.timestamp)) {
      keys.add(formatLocalDateKey(row.timestamp));
    }
  }

  const dmRows = db.all<{ created_at: number; updated_at: number }>(
    `SELECT created_at, updated_at FROM durable_memories WHERE state = 'active' AND ${dmScope.clause}`,
    dmScope.params,
  );
  for (const row of dmRows) {
    if (Number.isFinite(row.created_at)) {
      keys.add(formatLocalDateKey(row.created_at));
    }
    if (Number.isFinite(row.updated_at)) {
      keys.add(formatLocalDateKey(row.updated_at));
    }
  }

  return [...keys].sort();
}

function parseLocalDateKeyBounds(dateKey: string): { from: number; to: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const fromDate = new Date(year, month, day, 0, 0, 0, 0);
  if (
    Number.isNaN(fromDate.getTime()) ||
    fromDate.getFullYear() !== year ||
    fromDate.getMonth() !== month ||
    fromDate.getDate() !== day
  ) {
    return undefined;
  }

  const toDate = new Date(year, month, day + 1, 0, 0, 0, 0);
  return { from: fromDate.getTime(), to: toDate.getTime() };
}

function extractHighlightText(kind: string, payloadJson: string | null): string | undefined {
  if (
    !payloadJson ||
    (kind !== 'user_prompt' && kind !== 'ai_response' && kind !== 'session_end')
  ) {
    return undefined;
  }

  let rawText: string | undefined;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload.prompt === 'string') {
      rawText = payload.prompt;
    } else if (typeof payload.response === 'string') {
      rawText = payload.response;
    } else if (typeof payload.summary === 'string') {
      rawText = payload.summary;
    }
  } catch {
    return undefined;
  }

  if (!rawText) {
    return undefined;
  }

  const collapsed = rawText.replace(/\s+/gu, ' ').trim();
  if (!collapsed) {
    return undefined;
  }

  const lower = collapsed.toLowerCase();
  if (HOOK_ECHO_PREFIXES.some((prefix) => lower.includes(prefix))) {
    return undefined;
  }

  return truncateText(collapsed, HIGHLIGHT_MAX_CHARS);
}

function buildDailyMarkdown(input: {
  dateKey: string;
  projectName: string;
  eventCount: number;
  sessionCount: number;
  decisionCount: number;
  durableRows: readonly DurableDailyRow[];
  modifiedFiles: readonly string[];
  highlights: readonly string[];
}): string {
  const lines: string[] = [
    `# ${input.dateKey} — ${input.projectName}`,
    `Stats: ${input.eventCount} events | ${input.sessionCount} sessions | ${input.decisionCount} decisions`,
  ];

  if (input.durableRows.length > 0) {
    lines.push('', '## Decisions & Durable Memory');
    for (const row of input.durableRows) {
      lines.push(`- [${row.memory_type}] ${truncateText(row.summary, DURABLE_MAX_CHARS)}`);
    }
  }

  if (input.modifiedFiles.length > 0) {
    lines.push('', '## Modified Files');
    for (const filePath of input.modifiedFiles) {
      lines.push(`- \`${filePath}\``);
    }
  }

  if (input.highlights.length > 0) {
    lines.push('', '## Highlights');
    for (const highlight of input.highlights) {
      lines.push(`- ${highlight}`);
    }
  }

  return lines.join('\n');
}

function truncateText(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function atomicWriteText(targetPath: string, content: string): void {
  const tempPath = `${targetPath}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}
