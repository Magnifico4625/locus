import type { DatabaseAdapter, InboxEvent } from '../types.js';

/**
 * Checks whether an event has already been processed by looking up
 * its event_id in the ingest_log table (unique index).
 */
export function isDuplicate(db: DatabaseAdapter, eventId: string): boolean {
  const row = db.get<{ id: number }>('SELECT id FROM ingest_log WHERE event_id = ?', [eventId]);
  return row !== undefined;
}

/**
 * Records a processed event in ingest_log.
 * Uses INSERT OR IGNORE for idempotency — safe to call multiple times
 * for the same event without error.
 */
export function recordProcessed(db: DatabaseAdapter, event: InboxEvent): void {
  db.run(
    'INSERT OR IGNORE INTO ingest_log (event_id, source, source_event_id, processed_at) VALUES (?, ?, ?, ?)',
    [event.event_id, event.source, event.source_event_id ?? null, Date.now()],
  );
}
