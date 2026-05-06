import type {
  DatabaseAdapter,
  DurableMemoryType,
  MemoryRecallCandidate,
  TimeRange,
} from '../types.js';
import { resolveTimeRange, summarizePayload } from '../tools/search.js';
import { handleTimeline } from '../tools/timeline.js';
import type { ParsedRecallQuery } from './query-parser.js';

interface DurableRecallRow {
  id: number;
  topic_key: string | null;
  memory_type: DurableMemoryType;
  summary: string;
  updated_at: number;
}

interface ConversationRecallRow {
  event_id: string;
  kind: string;
  timestamp: number;
  payload_json: string | null;
  session_id: string | null;
}

export interface CandidateLoaderOptions {
  db: DatabaseAdapter;
  parsedQuery: ParsedRecallQuery;
  timeRange?: TimeRange;
  now: number;
  limit: number;
}

const DURABLE_TYPES_BY_INTENT: Partial<Record<ParsedRecallQuery['intent'], DurableMemoryType[]>> = {
  decision: ['decision'],
  preference_style: ['preference', 'style', 'constraint'],
  general: ['decision', 'preference', 'style', 'constraint'],
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemLite(term: string): string {
  if (/^ошиб(?:ка|ки|ку|ке|кой|ок|ками)?$/u.test(term)) {
    return 'ошибк';
  }

  return term;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function textTerms(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const terms = normalized.split(' ');
  return unique([...terms, ...terms.map(stemLite)]);
}

function matchingTerms(text: string, queryTerms: string[]): string[] {
  if (queryTerms.length === 0) {
    return [];
  }

  const textTermSet = new Set(textTerms(text));
  const normalizedText = normalizeText(text);
  return queryTerms.filter((term) => textTermSet.has(term) || normalizedText.includes(term));
}

function shouldKeepByTerms(text: string, queryTerms: string[]): boolean {
  return queryTerms.length === 0 || matchingTerms(text, queryTerms).length > 0;
}

function durableTypesForIntent(intent: ParsedRecallQuery['intent']): DurableMemoryType[] {
  return DURABLE_TYPES_BY_INTENT[intent] ?? [];
}

export function buildRecallFtsQuery(terms: string[]): string {
  return terms
    .map((term) => term.replace(/["*]/g, '').trim())
    .filter((term) => /^[\p{L}\p{N}_-]{2,}$/u.test(term))
    .map((term) => (term.length >= 3 ? `${term}*` : term))
    .join(' ');
}

function loadDurableCandidates({
  db,
  parsedQuery,
  timeRange,
  now,
  limit,
}: CandidateLoaderOptions): MemoryRecallCandidate[] {
  const memoryTypes = durableTypesForIntent(parsedQuery.intent);
  if (memoryTypes.length === 0) {
    return [];
  }

  const params: unknown[] = [];
  const clauses = ['state = ?'];
  params.push('active');

  clauses.push(`memory_type IN (${memoryTypes.map(() => '?').join(', ')})`);
  params.push(...memoryTypes);

  if (timeRange) {
    const resolved = resolveTimeRange(timeRange, now);
    clauses.push('updated_at >= ?');
    params.push(resolved.from);
    clauses.push('updated_at <= ?');
    params.push(resolved.to);
  }

  const rows = db.all<DurableRecallRow>(
    `SELECT id, topic_key, memory_type, summary, updated_at
     FROM durable_memories
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit],
  );

  return rows
    .filter((row) => {
      if (parsedQuery.intent === 'preference_style') {
        return true;
      }
      return (
        parsedQuery.topicHints.includes(row.topic_key ?? '') ||
        shouldKeepByTerms(row.summary, parsedQuery.termVariants)
      );
    })
    .map((row) => ({
      headline: row.summary,
      whyMatched: `durable ${row.memory_type} memory`,
      eventIds: [],
      durableMemoryIds: [row.id],
      intent: parsedQuery.intent,
      topicKey: row.topic_key ?? undefined,
      matchedTerms: matchingTerms(row.summary, parsedQuery.termVariants),
      sourceKind: 'durable',
      timestamp: row.updated_at,
    }));
}

function loadConversationCandidates({
  db,
  parsedQuery,
  timeRange,
  now,
  limit,
}: CandidateLoaderOptions): MemoryRecallCandidate[] {
  if (parsedQuery.termVariants.length > 0) {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (timeRange) {
      const resolved = resolveTimeRange(timeRange, now);
      clauses.push('timestamp >= ?');
      params.push(resolved.from);
      clauses.push('timestamp <= ?');
      params.push(resolved.to);
    }

    const termClauses = parsedQuery.termVariants.map(
      () => 'LOWER(COALESCE(payload_json, ?)) LIKE ?',
    );
    const termParams = parsedQuery.termVariants.flatMap((term) => ['', `%${term.toLowerCase()}%`]);
    clauses.push(`(${termClauses.join(' OR ')})`);
    params.push(...termParams);

    const rows = db.all<ConversationRecallRow>(
      `SELECT event_id, kind, timestamp, payload_json, session_id
       FROM conversation_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY timestamp DESC, id DESC
       LIMIT ?`,
      [...params, limit],
    );

    return rows
      .map((row) => {
        const headline = summarizePayload(row.kind, row.payload_json);
        return {
          sessionId: row.session_id ?? undefined,
          headline,
          whyMatched: 'recent conversation context',
          eventIds: [row.event_id],
          durableMemoryIds: [],
          intent: parsedQuery.intent,
          matchedTerms: matchingTerms(headline, parsedQuery.termVariants),
          sourceKind: 'conversation' as const,
          timestamp: row.timestamp,
        };
      })
      .filter((candidate) => candidate.matchedTerms.length > 0);
  }

  const entries = handleTimeline(
    { db },
    {
      timeRange,
      summary: false,
      limit,
      now,
    },
  );

  return entries
    .filter((entry) => typeof entry.summary === 'string')
    .map((entry) => ({
      sessionId: entry.sessionId ?? undefined,
      headline: entry.summary ?? entry.kind,
      whyMatched: 'recent conversation context',
      eventIds: [entry.eventId],
      durableMemoryIds: [],
      intent: parsedQuery.intent,
      matchedTerms: [],
      sourceKind: 'conversation' as const,
      timestamp: entry.timestamp,
    }));
}

export function loadRecallCandidates(options: CandidateLoaderOptions): MemoryRecallCandidate[] {
  return [
    ...loadDurableCandidates(options),
    ...loadConversationCandidates(options),
  ];
}
