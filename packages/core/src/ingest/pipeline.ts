import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseAdapter, IngestMetrics } from '../types.js';
import { isDuplicate, recordProcessed } from './dedup.js';
import { validateInboxEvent } from './schema.js';

export interface ProcessInboxOptions {
  /** Max events to process per run. 0 = unlimited (default). */
  batchLimit?: number;
}

/**
 * Reads JSON event files from the inbox directory, validates schema,
 * checks for duplicates, and records processed events in ingest_log.
 *
 * Pipeline phases (Task 6 — intake only):
 * 1. Scan inbox dir for .json files
 * 2. Sort by filename (timestamp-prefixed → chronological order)
 * 3. Apply batch limit
 * 4. For each file: parse → validate → dedup → record → delete
 *
 * Invalid files (parse error, schema failure) are left in inbox for debugging.
 * Processed and duplicate files are deleted.
 */
export function processInbox(
  inboxDir: string,
  db: DatabaseAdapter,
  options?: ProcessInboxOptions,
): IngestMetrics {
  const start = Date.now();
  const metrics: IngestMetrics = {
    processed: 0,
    skipped: 0,
    duplicates: 0,
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

    const event = validateInboxEvent(parsed);
    if (!event) {
      metrics.skipped++;
      continue;
    }

    if (isDuplicate(db, event.event_id)) {
      metrics.duplicates++;
      try {
        unlinkSync(filePath);
      } catch {
        // Best effort — file may already be gone
      }
      continue;
    }

    recordProcessed(db, event);
    try {
      unlinkSync(filePath);
    } catch {
      // Best effort cleanup
    }
    metrics.processed++;
  }

  metrics.durationMs = Date.now() - start;
  return metrics;
}
