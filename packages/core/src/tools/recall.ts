import { handleTimeline } from './timeline.js';
import { resolveTimeRange } from './search.js';
import type {
  DatabaseAdapter,
  MemoryRecallCandidate,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
  TimeRange,
} from '../types.js';

interface RecallDeps {
  db: DatabaseAdapter;
  now?: number;
}

export interface RecallOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
}

interface DurableRecallRow {
  id: number;
  summary: string;
  updated_at: number;
}

const QUESTION_STOP_WORDS = new Set([
  'what',
  'did',
  'we',
  'do',
  'about',
  'the',
  'a',
  'an',
  'our',
  'last',
  'week',
  'yesterday',
  'today',
  'just',
  'decide',
  'decided',
  'fix',
  'fixed',
]);

function parseQuestionTerms(question: string): string[] {
  const normalized = question.toLowerCase().replace(/[^a-z0-9\s]+/gi, ' ');
  return normalized
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !QUESTION_STOP_WORDS.has(term));
}

function matchesTerms(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  if (terms.length === 0) {
    return true;
  }

  return terms.some((term) => normalized.includes(term));
}

function parseRange(question: string, now: number): { timeRange?: TimeRange; resolvedRange?: MemoryRecallResolvedRange } {
  const lower = question.toLowerCase();

  if (lower.includes('yesterday')) {
    return buildResolvedRange('yesterday', { relative: 'yesterday' }, now);
  }

  if (lower.includes('last week')) {
    return buildResolvedRange('last week', { relative: 'last_7d' }, now);
  }

  if (lower.includes('today')) {
    return buildResolvedRange('today', { relative: 'today' }, now);
  }

  return {};
}

function resolveRangeLabel(timeRange: TimeRange): string {
  if (timeRange.relative) {
    return timeRange.relative;
  }

  return 'custom';
}

function buildResolvedRange(
  label: string,
  timeRange: TimeRange,
  now: number,
): { timeRange: TimeRange; resolvedRange: MemoryRecallResolvedRange } {
  const resolved = resolveTimeRange(timeRange, now, 'utc');
  return {
    timeRange,
    resolvedRange: {
      label,
      from: resolved.from,
      to: resolved.to,
      fromIso: new Date(resolved.from).toISOString(),
      toIso: new Date(resolved.to).toISOString(),
    },
  };
}

function loadDurableCandidates(
  db: DatabaseAdapter,
  questionTerms: string[],
  timeRange: TimeRange | undefined,
  now: number,
  limit: number,
): MemoryRecallCandidate[] {
  const params: unknown[] = [];
  const clauses = ["memory_type = 'decision'", "state = 'active'"];

  if (timeRange) {
    const resolved = resolveTimeRange(timeRange, now);
    clauses.push('updated_at >= ?');
    params.push(resolved.from);
    clauses.push('updated_at <= ?');
    params.push(resolved.to);
  }

  const rows = db.all<DurableRecallRow>(
    `SELECT id, summary, updated_at
     FROM durable_memories
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit],
  );

  return rows
    .filter((row) => matchesTerms(row.summary, questionTerms))
    .map((row) => ({
      headline: row.summary,
      whyMatched: 'durable decision memory',
      eventIds: [],
      durableMemoryIds: [row.id],
    }));
}

function loadConversationCandidates(
  db: DatabaseAdapter,
  questionTerms: string[],
  timeRange: TimeRange | undefined,
  now: number,
  limit: number,
): MemoryRecallCandidate[] {
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
    .filter((entry) => typeof entry.summary === 'string' && matchesTerms(entry.summary, questionTerms))
    .map((entry) => ({
      sessionId: entry.sessionId ?? undefined,
      headline: entry.summary ?? entry.kind,
      whyMatched: 'recent conversation context',
      eventIds: [entry.eventId],
      durableMemoryIds: [],
    }));
}

function buildResult(
  question: string,
  candidates: MemoryRecallCandidate[],
  resolvedRange?: MemoryRecallResolvedRange,
): MemoryRecallResult {
  if (candidates.length === 0) {
    return {
      status: 'no_memory',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      summary: 'No matching memory found.',
      candidates: [],
    };
  }

  if (candidates.length > 1) {
    return {
      status: 'needs_clarification',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      summary: 'I found multiple possible matches. Please clarify which one you mean.',
      candidates,
    };
  }

  const candidate = candidates[0] as MemoryRecallCandidate;
  return {
    status: 'ok',
    question,
    ...(resolvedRange ? { resolvedRange } : {}),
    summary: candidate.headline,
    candidates: [candidate],
  };
}

export function handleRecall(
  question: string,
  deps: RecallDeps,
  options?: RecallOptions,
): MemoryRecallResult {
  const now = options?.now ?? deps.now ?? Date.now();
  const limit = Math.max(1, options?.limit ?? 10);
  const questionTerms = parseQuestionTerms(question);
  const questionRange = parseRange(question, now);
  const explicitRange = options?.timeRange
    ? buildResolvedRange(resolveRangeLabel(options.timeRange), options.timeRange, now)
    : undefined;
  const timeRange = explicitRange?.timeRange ?? questionRange.timeRange;
  const resolvedRange = explicitRange?.resolvedRange ?? questionRange.resolvedRange;

  const durableCandidates = loadDurableCandidates(deps.db, questionTerms, timeRange, now, limit);
  const conversationCandidates = loadConversationCandidates(
    deps.db,
    questionTerms,
    timeRange,
    now,
    limit,
  );

  const candidates = [...durableCandidates, ...conversationCandidates];
  return buildResult(question, candidates, resolvedRange);
}
