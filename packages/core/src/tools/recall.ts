import type {
  DatabaseAdapter,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
  TimeRange,
} from '../types.js';
import {
  buildRecallResult,
  loadRecallCandidates,
  parseRecallQuery,
  scoreRecallCandidates,
} from '../recall/index.js';
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
  const scoredCandidates = scoreRecallCandidates(candidates, parsedQuery, { now });
  return buildRecallResult({ question, candidates: scoredCandidates, resolvedRange });
}
