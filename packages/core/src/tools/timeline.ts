import type { DatabaseAdapter, EventKind, TimeRange } from '../types.js';
import { resolveTimeRange, summarizePayload } from './search.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface TimelineDeps {
  db: DatabaseAdapter;
}

export interface TimelineOptions {
  timeRange?: TimeRange;
  kind?: EventKind;
  filePath?: string;
  summary?: boolean;
  limit?: number;
  offset?: number;
}

export interface TimelineEntry {
  eventId: string;
  kind: EventKind;
  timestamp: number;
  significance: string | null;
  sessionId: string | null;
  summary?: string;
  files?: string[];
}

// ─── Internal row type ────────────────────────────────────────────────────────

interface TimelineRow {
  event_id: string;
  kind: string;
  timestamp: number;
  significance: string | null;
  session_id: string | null;
  payload_json: string | null;
}

interface FilePathRow {
  file_path: string;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function handleTimeline(deps: TimelineDeps, options?: TimelineOptions): TimelineEntry[] {
  const { db } = deps;
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const isSummary = options?.summary ?? false;

  // Build WHERE clause
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options?.timeRange) {
    const resolved = resolveTimeRange(options.timeRange);
    clauses.push('ce.timestamp >= ?');
    params.push(resolved.from);
    clauses.push('ce.timestamp <= ?');
    params.push(resolved.to);
  }

  if (options?.kind) {
    clauses.push('ce.kind = ?');
    params.push(options.kind);
  }

  if (options?.filePath) {
    clauses.push('ce.event_id IN (SELECT event_id FROM event_files WHERE file_path = ?)');
    params.push(options.filePath);
  }

  const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT ce.event_id, ce.kind, ce.timestamp, ce.significance,
           ce.session_id, ce.payload_json
    FROM conversation_events ce
    ${whereStr}
    ORDER BY ce.timestamp DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);

  const rows = db.all<TimelineRow>(sql, params);

  return rows.map((row) => {
    const entry: TimelineEntry = {
      eventId: row.event_id,
      kind: row.kind as EventKind,
      timestamp: row.timestamp,
      significance: row.significance,
      sessionId: row.session_id,
    };

    if (!isSummary) {
      entry.summary = summarizePayload(row.kind, row.payload_json);

      const files = db.all<FilePathRow>('SELECT file_path FROM event_files WHERE event_id = ?', [
        row.event_id,
      ]);
      if (files.length > 0) {
        entry.files = files.map((f) => f.file_path);
      }
    }

    return entry;
  });
}
