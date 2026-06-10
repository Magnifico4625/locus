import { dayBucket, monthBucket, weekBucket } from '../recall/calendar.js';
import { normalizeProjectRootForScope } from '../recall/project-scope.js';
import type {
  DatabaseAdapter,
  MemoryCalendarOptions,
  MemoryCalendarResult,
  MemoryDateBucket,
  MemoryRecallResolvedRange,
  TimeRange,
} from '../types.js';
import { resolveTimeRange } from './search.js';

export interface CalendarDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  now?: number;
}

interface CalendarEventRow {
  timestamp: number;
  session_id: string | null;
}

interface CalendarDurableRow {
  updated_at: number;
  topic_key: string | null;
}

interface MutableCalendarBucket {
  key: string;
  label: string;
  from: number;
  to: number;
  eventCount: number;
  durableCount: number;
  sessionIds: Set<string>;
  topicKeys: Set<string>;
}

type CalendarGranularity = 'day' | 'week' | 'month';

const DEFAULT_RANGE: TimeRange = { relative: 'last_30d' };
const DEFAULT_LIMIT = 90;

function resolveRangeLabel(timeRange: TimeRange): string {
  return timeRange.relative ?? 'custom';
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

function buildResolvedRange(timeRange: TimeRange, now: number): MemoryRecallResolvedRange {
  const resolved = resolveTimeRange(timeRange, now, 'local');
  const granularity = resolveRangeGranularity(timeRange);
  return {
    label: resolveRangeLabel(timeRange),
    from: resolved.from,
    to: resolved.to,
    fromIso: new Date(resolved.from).toISOString(),
    toIso: new Date(resolved.to).toISOString(),
    ...(granularity ? { granularity } : {}),
  };
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(0, Math.trunc(limit));
}

function bucketFor(timestamp: number, granularity: CalendarGranularity) {
  switch (granularity) {
    case 'day':
      return dayBucket(timestamp, { mode: 'local' });
    case 'week':
      return weekBucket(timestamp, { mode: 'local' });
    case 'month':
      return monthBucket(timestamp, { mode: 'local' });
  }
}

function getOrCreateBucket(
  buckets: Map<string, MutableCalendarBucket>,
  timestamp: number,
  granularity: CalendarGranularity,
): MutableCalendarBucket {
  const range = bucketFor(timestamp, granularity);
  const existing = buckets.get(range.key);
  if (existing) {
    return existing;
  }

  const created: MutableCalendarBucket = {
    key: range.key,
    label: range.label,
    from: range.from,
    to: range.to,
    eventCount: 0,
    durableCount: 0,
    sessionIds: new Set<string>(),
    topicKeys: new Set<string>(),
  };
  buckets.set(range.key, created);
  return created;
}

function finalizeBucket(bucket: MutableCalendarBucket): MemoryDateBucket {
  return {
    key: bucket.key,
    label: bucket.label,
    from: bucket.from,
    to: bucket.to,
    eventCount: bucket.eventCount,
    sessionCount: bucket.sessionIds.size,
    durableCount: bucket.durableCount,
    topicKeys: Array.from(bucket.topicKeys).sort(),
  };
}

export function handleCalendar(
  deps: CalendarDeps,
  options?: MemoryCalendarOptions,
): MemoryCalendarResult {
  const { db } = deps;
  const now = deps.now ?? Date.now();
  const projectRoot = normalizeProjectRootForScope(options?.projectRoot ?? deps.projectRoot);
  const timeRange = options?.timeRange ?? DEFAULT_RANGE;
  const resolvedRange = buildResolvedRange(timeRange, now);
  const granularity = options?.granularity ?? 'day';
  const limit = normalizeLimit(options?.limit);

  const eventRows = db.all<CalendarEventRow>(
    `SELECT timestamp, session_id
     FROM conversation_events
     WHERE project_root = ?
       AND timestamp >= ?
       AND timestamp < ?
     ORDER BY timestamp ASC`,
    [projectRoot, resolvedRange.from, resolvedRange.to],
  );
  const durableRows = db.all<CalendarDurableRow>(
    `SELECT updated_at, topic_key
     FROM durable_memories
     WHERE project_root = ?
       AND updated_at >= ?
       AND updated_at < ?
     ORDER BY updated_at ASC`,
    [projectRoot, resolvedRange.from, resolvedRange.to],
  );

  const buckets = new Map<string, MutableCalendarBucket>();
  for (const row of eventRows) {
    const bucket = getOrCreateBucket(buckets, row.timestamp, granularity);
    bucket.eventCount += 1;
    if (row.session_id) {
      bucket.sessionIds.add(row.session_id);
    }
  }

  for (const row of durableRows) {
    const bucket = getOrCreateBucket(buckets, row.updated_at, granularity);
    bucket.durableCount += 1;
    if (row.topic_key) {
      bucket.topicKeys.add(row.topic_key);
    }
  }

  return {
    projectRoot,
    resolvedRange,
    granularity,
    buckets: Array.from(buckets.values())
      .sort((left, right) => left.from - right.from)
      .slice(0, limit)
      .map(finalizeBucket),
  };
}
