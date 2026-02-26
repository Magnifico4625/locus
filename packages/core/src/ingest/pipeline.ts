import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../security/redact.js';
import type { CaptureLevel, DatabaseAdapter, InboxEvent, IngestMetrics } from '../types.js';
import { isDuplicate, recordProcessed } from './dedup.js';
import { captureLevelGate, classifySignificance, shouldDedup } from './filters.js';
import { validateInboxEvent } from './schema.js';

export interface ProcessInboxOptions {
  /** Max events to process per run. 0 = unlimited (default). */
  batchLimit?: number;
  /** CaptureLevel gate — second defense layer. Default: 'metadata'. */
  captureLevel?: CaptureLevel;
  /** Whether FTS5 is available for full-text indexing. Default: false. */
  fts5Available?: boolean;
}

/**
 * 4-phase ingest pipeline: Intake → Filter → Transform → Store.
 *
 * 1. INTAKE: Scan inbox dir, sort by filename, parse JSON, validate schema, dedup by event_id
 * 2. FILTER: CaptureLevel gate, significance classification, similarity dedup
 * 3. TRANSFORM: Redact secrets in payload
 * 4. STORE: Write to conversation_events, event_files, conversation_fts, ingest_log; delete inbox file
 *
 * Invalid files (parse error, schema failure) are left in inbox for debugging.
 * All other processed files (stored, filtered, duplicated) are deleted.
 */
export function processInbox(
  inboxDir: string,
  db: DatabaseAdapter,
  options?: ProcessInboxOptions,
): IngestMetrics {
  const start = Date.now();
  const captureLevel = options?.captureLevel ?? 'metadata';
  const fts5 = options?.fts5Available ?? false;

  const metrics: IngestMetrics = {
    processed: 0,
    skipped: 0,
    duplicates: 0,
    filtered: 0,
    errors: 0,
    durationMs: 0,
    remaining: 0,
  };

  let files: string[];
  try {
    files = readdirSync(inboxDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    // Directory doesn't exist or can't be read — nothing to process
    metrics.durationMs = Date.now() - start;
    return metrics;
  }

  const limit = options?.batchLimit ?? 0;
  let toProcess: string[];
  if (limit > 0 && files.length > limit) {
    toProcess = files.slice(0, limit);
    metrics.remaining = files.length - limit;
  } else {
    toProcess = files;
  }

  for (const filename of toProcess) {
    const filePath = join(inboxDir, filename);

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      metrics.errors++;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      metrics.errors++;
      continue;
    }

    // Phase 1: INTAKE — schema validation
    const event = validateInboxEvent(parsed);
    if (!event) {
      metrics.skipped++;
      continue;
    }

    // Phase 1: INTAKE — event_id dedup
    if (isDuplicate(db, event.event_id)) {
      metrics.duplicates++;
      tryDelete(filePath);
      continue;
    }

    // Phase 2: FILTER — captureLevel gate (second defense)
    if (!captureLevelGate(event, captureLevel)) {
      metrics.filtered++;
      tryDelete(filePath);
      continue;
    }

    // Phase 2: FILTER — similarity dedup
    if (shouldDedup(event, db)) {
      metrics.duplicates++;
      tryDelete(filePath);
      continue;
    }

    // Phase 2: FILTER — classify significance
    const significance = classifySignificance(event);

    // Phase 3: TRANSFORM — redact secrets in payload
    const payloadJson = redact(JSON.stringify(event.payload));

    // Phase 4: STORE — write to conversation_events
    const result = db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id,
        timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.event_id,
        event.source,
        event.source_event_id ?? null,
        event.project_root,
        event.session_id ?? null,
        event.timestamp,
        event.kind,
        payloadJson,
        significance,
        null, // tags_json — Phase 2 (RAKE/TF-IDF)
        Date.now(),
      ],
    );

    // Phase 4: STORE — write to event_files (join table)
    const filePaths = extractFilePaths(event);
    for (const fp of filePaths) {
      db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [event.event_id, fp]);
    }

    // Phase 4: STORE — update FTS index (if available)
    if (fts5) {
      const ftsContent = extractFtsContent(event);
      if (ftsContent) {
        try {
          db.run('INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)', [
            result.lastInsertRowid,
            redact(ftsContent),
          ]);
        } catch {
          // FTS insert failure should not block pipeline
        }
      }
    }

    // Phase 4: STORE — record in ingest_log
    recordProcessed(db, event);

    // Phase 4: STORE — delete processed inbox file
    tryDelete(filePath);

    metrics.processed++;
  }

  metrics.durationMs = Date.now() - start;
  return metrics;
}

/**
 * Extracts file paths from event payload for the event_files join table.
 * - tool_use: payload.files (string[])
 * - file_diff: payload.path (string)
 * - other kinds: no file paths
 */
function extractFilePaths(event: InboxEvent): string[] {
  const payload = event.payload;

  if (event.kind === 'tool_use') {
    const files = payload.files;
    if (Array.isArray(files)) {
      return files.filter((f): f is string => typeof f === 'string');
    }
  }

  if (event.kind === 'file_diff') {
    const path = payload.path;
    if (typeof path === 'string' && path.length > 0) {
      return [path];
    }
  }

  return [];
}

/**
 * Builds searchable FTS content from the event.
 * Combines event kind with relevant payload text for full-text search.
 */
function extractFtsContent(event: InboxEvent): string {
  const payload = event.payload;
  const parts: string[] = [event.kind];

  switch (event.kind) {
    case 'user_prompt': {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      if (prompt) parts.push(prompt);
      break;
    }
    case 'ai_response': {
      const response = typeof payload.response === 'string' ? payload.response : '';
      if (response) parts.push(response);
      break;
    }
    case 'tool_use': {
      const tool = typeof payload.tool === 'string' ? payload.tool : '';
      if (tool) parts.push(tool);
      const files = payload.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          if (typeof f === 'string') parts.push(f);
        }
      }
      break;
    }
    case 'file_diff': {
      const path = typeof payload.path === 'string' ? payload.path : '';
      if (path) parts.push(path);
      break;
    }
    case 'session_start': {
      const tool = typeof payload.tool === 'string' ? payload.tool : '';
      if (tool) parts.push(tool);
      break;
    }
    case 'session_end': {
      const summary = typeof payload.summary === 'string' ? payload.summary : '';
      if (summary) parts.push(summary);
      break;
    }
  }

  return parts.join(' ');
}

/** Best-effort file deletion — never throws. */
function tryDelete(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort — file may already be gone
  }
}
