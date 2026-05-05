import type {
  DatabaseAdapter,
  MemoryRecallCandidate,
  MemoryRecallCandidateGroup,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
  TimeRange,
} from '../types.js';
import { loadRecallCandidates, parseRecallQuery } from '../recall/index.js';
import { resolveTimeRange } from './search.js';

interface RecallDeps {
  db: DatabaseAdapter;
  now?: number;
}

export interface RecallOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
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
      candidateGroups: buildCandidateGroups(candidates),
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
  const parsedQuery = parseRecallQuery(question, now);
  const explicitRange = options?.timeRange
    ? buildResolvedRange(resolveRangeLabel(options.timeRange), options.timeRange, now)
    : undefined;
  const timeRange =
    explicitRange?.timeRange ??
    (parsedQuery.temporalRange
      ? { from: parsedQuery.temporalRange.from, to: parsedQuery.temporalRange.to }
      : undefined);
  const resolvedRange = explicitRange?.resolvedRange ?? parsedQuery.temporalRange;

  const candidates = loadRecallCandidates({
    db: deps.db,
    parsedQuery,
    timeRange,
    now,
    limit,
  });
  return buildResult(question, candidates, resolvedRange);
}

function buildCandidateGroups(candidates: MemoryRecallCandidate[]): MemoryRecallCandidateGroup[] {
  return candidates.map((candidate, index) => {
    const eventIds = [...candidate.eventIds];
    const durableMemoryIds = [...candidate.durableMemoryIds];
    const id = candidate.sessionId
      ? `session:${candidate.sessionId}`
      : durableMemoryIds[0] !== undefined
        ? `durable:${durableMemoryIds[0]}`
        : eventIds[0] !== undefined
          ? `event:${eventIds[0]}`
          : `candidate:${index}`;

    return {
      id,
      heading: candidate.headline,
      whyMatched: candidate.whyMatched,
      candidates: [candidate],
      eventIds,
      durableMemoryIds,
      ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {}),
      ...(candidate.topicKey ? { topicKey: candidate.topicKey } : {}),
      ...(candidate.confidence ? { confidence: candidate.confidence } : {}),
    };
  });
}
