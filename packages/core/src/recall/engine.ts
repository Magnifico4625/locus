import { resolveTimeRange } from '../tools/search.js';
import type {
  DatabaseAdapter,
  MemoryDateBucket,
  MemoryRecallCandidate,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
  TimeRange,
} from '../types.js';
import { dayBucket } from './calendar.js';
import { loadRecallCandidates } from './candidate-loader.js';
import { parseRecallQuery } from './query-parser.js';
import { buildRecallResult } from './result-builder.js';
import { filterProjectCandidates, scoreRecallCandidates } from './scoring.js';

export interface RecallEngineDeps {
  db: DatabaseAdapter;
  now?: number;
  projectRoot?: string;
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

interface BucketAccumulator {
  key: string;
  label: string;
  from: number;
  to: number;
  eventCount: number;
  durableCount: number;
  sessionIds: Set<string>;
  topicKeys: Set<string>;
}

function buildBucketsForCandidates(
  candidates: readonly MemoryRecallCandidate[],
  resolvedRange: MemoryRecallResolvedRange,
): MemoryDateBucket[] {
  const buckets = new Map<string, BucketAccumulator>();

  for (const candidate of candidates) {
    if (candidate.timestamp === undefined) {
      continue;
    }
    if (candidate.timestamp < resolvedRange.from || candidate.timestamp >= resolvedRange.to) {
      continue;
    }

    const day = dayBucket(candidate.timestamp, { mode: 'local' });
    const key = candidate.localDate ?? day.key;
    const bucket =
      buckets.get(key) ??
      ({
        key,
        label: key,
        from: day.from,
        to: day.to,
        eventCount: 0,
        durableCount: 0,
        sessionIds: new Set<string>(),
        topicKeys: new Set<string>(),
      } satisfies BucketAccumulator);

    bucket.eventCount += candidate.eventIds.length;
    bucket.durableCount += candidate.durableMemoryIds.length;
    if (candidate.sessionId) {
      bucket.sessionIds.add(candidate.sessionId);
    }
    if (candidate.topicKey) {
      bucket.topicKeys.add(candidate.topicKey);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => left.from - right.from)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      from: bucket.from,
      to: bucket.to,
      eventCount: bucket.eventCount,
      sessionCount: bucket.sessionIds.size,
      durableCount: bucket.durableCount,
      topicKeys: [...bucket.topicKeys].sort(),
    }));
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

  const loadedCandidates = loadRecallCandidates({
    db: deps.db,
    parsedQuery,
    timeRange,
    now,
    limit,
    projectRoot: deps.projectRoot,
  });
  const candidates = filterProjectCandidates(loadedCandidates, deps.projectRoot);
  const scoredCandidates = scoreRecallCandidates(candidates, parsedQuery, {
    now,
    projectRoot: deps.projectRoot,
    resolvedRange: resolvedRange ? { from: resolvedRange.from, to: resolvedRange.to } : undefined,
  }).slice(0, limit);
  const searchedDateBuckets = resolvedRange
    ? buildBucketsForCandidates(scoredCandidates, resolvedRange)
    : undefined;

  return buildRecallResult({
    question,
    candidates: scoredCandidates,
    resolvedRange,
    searchedDateBuckets,
    matchedIntent: parsedQuery.intent,
    matchedTopics: parsedQuery.topicHints,
  });
}
