import { DurableMemoryStore } from './durable.js';
import { extractDurableCandidatesFromEvent } from './durable-extractor.js';
import { mergeDurableCandidate } from './durable-merge.js';
import type { ConversationEventRow, DatabaseAdapter } from '../types.js';

const DEFAULT_SOURCE = 'codex';
const WATERMARK_PREFIX = 'durable';

interface WatermarkRow {
  value: string | null;
}

interface CountRow {
  cnt: number;
}

interface RunnerOptions {
  source?: string;
}

export interface DurableExtractionMetrics {
  scanned: number;
  inserted: number;
  confirmed: number;
  superseded: number;
  ignored: number;
  watermarkEventId: number;
}

function getWatermarkKey(source: string): string {
  return `${WATERMARK_PREFIX}.${source}.last_event_id`;
}

function getWatermark(db: DatabaseAdapter, source: string): number {
  const row = db.get<WatermarkRow>('SELECT value FROM scan_state WHERE key = ?', [getWatermarkKey(source)]);
  return Number(row?.value ?? '0') || 0;
}

function setWatermark(db: DatabaseAdapter, source: string, eventId: number): void {
  db.run(
    `INSERT INTO scan_state(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [getWatermarkKey(source), String(eventId)],
  );
}

function loadConversationEvents(
  db: DatabaseAdapter,
  source: string,
  lastEventId: number,
): ConversationEventRow[] {
  return db.all<ConversationEventRow>(
    `SELECT *
     FROM conversation_events
     WHERE source = ? AND id > ?
     ORDER BY id ASC`,
    [source, lastEventId],
  );
}

function hasDurableFts(db: DatabaseAdapter): boolean {
  const row = db.get<CountRow>(
    "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['durable_memories_fts'],
  );
  return (row?.cnt ?? 0) > 0;
}

export function runDurableExtraction(
  db: DatabaseAdapter,
  options?: RunnerOptions,
): DurableExtractionMetrics {
  const source = options?.source ?? DEFAULT_SOURCE;
  const store = new DurableMemoryStore(db, hasDurableFts(db));
  const lastEventId = getWatermark(db, source);
  const events = loadConversationEvents(db, source, lastEventId);

  const metrics: DurableExtractionMetrics = {
    scanned: 0,
    inserted: 0,
    confirmed: 0,
    superseded: 0,
    ignored: 0,
    watermarkEventId: lastEventId,
  };

  for (const event of events) {
    const candidates = extractDurableCandidatesFromEvent(event);
    metrics.scanned++;

    for (const candidate of candidates) {
      const existingEntries = candidate.topicKey
        ? store.listByTopic(candidate.topicKey)
        : store.listByMemoryType(candidate.memoryType);
      const decision = mergeDurableCandidate(existingEntries, candidate);

      switch (decision.action) {
        case 'ignore':
          metrics.ignored++;
          break;
        case 'confirm_existing':
          store.updateState(decision.existingId, 'active');
          metrics.confirmed++;
          break;
        case 'insert_new_active':
          store.insert({
            topicKey: candidate.topicKey,
            memoryType: candidate.memoryType,
            summary: candidate.summary,
            evidence: candidate.evidence,
            sourceEventId: candidate.sourceEventId,
            source: candidate.source,
            state: 'active',
          });
          metrics.inserted++;
          break;
        case 'supersede_existing': {
          const inserted = store.insert({
            topicKey: candidate.topicKey,
            memoryType: candidate.memoryType,
            summary: candidate.summary,
            evidence: candidate.evidence,
            sourceEventId: candidate.sourceEventId,
            source: candidate.source,
            state: 'active',
          });
          store.updateState(decision.existingId, 'superseded', inserted.id);
          metrics.superseded++;
          break;
        }
      }
    }

    metrics.watermarkEventId = event.id;
    setWatermark(db, source, event.id);
  }

  return metrics;
}
