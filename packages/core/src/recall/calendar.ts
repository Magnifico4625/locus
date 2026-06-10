export type DateBucketGranularity = 'day' | 'week' | 'month';

export interface DateBucketOptions {
  mode?: 'local' | 'utc';
}

export interface DateBucketRange {
  key: string;
  label: string;
  from: number;
  to: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(timestamp: number, mode: 'local' | 'utc'): string {
  const date = new Date(timestamp);
  const year = mode === 'utc' ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === 'utc' ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = mode === 'utc' ? date.getUTCDate() : date.getDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthKey(timestamp: number, mode: 'local' | 'utc'): string {
  const date = new Date(timestamp);
  const year = mode === 'utc' ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === 'utc' ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  return `${year}-${pad2(month)}`;
}

export function startOfDay(timestamp: number, options?: DateBucketOptions): number {
  const mode = options?.mode ?? 'local';
  const date = new Date(timestamp);
  if (mode === 'utc') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addDays(timestamp: number, days: number, mode: 'local' | 'utc'): number {
  const date = new Date(timestamp);
  if (mode === 'utc') {
    date.setUTCDate(date.getUTCDate() + days);
  } else {
    date.setDate(date.getDate() + days);
  }
  return date.getTime();
}

function startOfMonth(timestamp: number, mode: 'local' | 'utc'): number {
  const date = new Date(timestamp);
  if (mode === 'utc') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }

  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addMonths(timestamp: number, months: number, mode: 'local' | 'utc'): number {
  const date = new Date(timestamp);
  if (mode === 'utc') {
    date.setUTCMonth(date.getUTCMonth() + months);
  } else {
    date.setMonth(date.getMonth() + months);
  }
  return date.getTime();
}

export function dayBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange {
  const mode = options?.mode ?? 'local';
  const from = startOfDay(timestamp, { mode });
  const to = addDays(from, 1, mode);
  const key = dateKey(from, mode);
  return { key, label: key, from, to };
}

export function weekBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange {
  const mode = options?.mode ?? 'local';
  const dayStart = startOfDay(timestamp, { mode });
  const date = new Date(dayStart);
  const day = mode === 'utc' ? date.getUTCDay() : date.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const from = addDays(dayStart, -mondayOffset, mode);
  const to = addDays(from, 7, mode);
  const key = `${dateKey(from, mode)}/week`;
  return { key, label: key, from, to };
}

export function monthBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange {
  const mode = options?.mode ?? 'local';
  const from = startOfMonth(timestamp, mode);
  const to = addMonths(from, 1, mode);
  const key = monthKey(from, mode);
  return { key, label: key, from, to };
}
