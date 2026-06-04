import { resolveTimeRange } from '../tools/search.js';
import type {
  DatabaseAdapter,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
  TimeRange,
} from '../types.js';
import { loadRecallCandidates } from './candidate-loader.js';
import { parseRecallQuery } from './query-parser.js';
import { buildRecallResult } from './result-builder.js';
import { scoreRecallCandidates } from './scoring.js';

export interface RecallEngineDeps {
  db: DatabaseAdapter;
  now?: number;
}

export interface RecallEngineOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
  temporalMode?: 'local' | 'utc';
}

function resolveRangeLabel(timeRange: TimeRange): string {
  if (timeRange.relative) {
    return timeRange.relative;
  }

  return 'custom';
}

function resolveRangeGranularity(
  timeRange: TimeRange,
): MemoryRecallResolvedRange['granularity'] | undefined {
  switch (timeRange.relative) {
    case 'today':
    case 'yesterday':
      return 'day';
    case 'this_week':
      return 'week';
    case 'this_month':
    case 'last_month':
      return 'month';
    case 'last_7d':
    case 'last_30d':
      return 'custom';
    default:
      return timeRange.relative ? undefined : 'custom';
  }
}

function buildResolvedRange(
  label: string,
  timeRange: TimeRange,
  now: number,
  temporalMode: 'local' | 'utc',
): { timeRange: TimeRange; resolvedRange: MemoryRecallResolvedRange } {
  const resolved = resolveTimeRange(timeRange, now, temporalMode);
  const granularity = resolveRangeGranularity(timeRange);
  return {
    timeRange,
    resolvedRange: {
      label,
      from: resolved.from,
      to: resolved.to,
      fromIso: new Date(resolved.from).toISOString(),
      toIso: new Date(resolved.to).toISOString(),
      ...(granularity ? { granularity } : {}),
    },
  };
}

export function runRecallEngine(
  question: string,
  deps: RecallEngineDeps,
  options?: RecallEngineOptions,
): MemoryRecallResult {
  const now = options?.now ?? deps.now ?? Date.now();
  const limit = Math.max(1, options?.limit ?? 10);
  const temporalMode = options?.temporalMode ?? 'local';
  const parsedQuery = parseRecallQuery(question, now, { temporalMode });
  const explicitRange = options?.timeRange
    ? buildResolvedRange(resolveRangeLabel(options.timeRange), options.timeRange, now, temporalMode)
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
  const scoredCandidates = scoreRecallCandidates(candidates, parsedQuery, { now }).slice(0, limit);

  return buildRecallResult({
    question,
    candidates: scoredCandidates,
    resolvedRange,
    matchedIntent: parsedQuery.intent,
    matchedTopics: parsedQuery.topicHints,
  });
}
