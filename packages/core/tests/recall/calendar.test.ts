import { describe, expect, it } from 'vitest';
import { dayBucket, monthBucket, weekBucket } from '../../src/recall/calendar.js';

describe('calendar buckets', () => {
  it('builds stable UTC day buckets', () => {
    expect(dayBucket(Date.parse('2026-05-30T12:34:00.000Z'), { mode: 'utc' })).toMatchObject({
      key: '2026-05-30',
      from: Date.parse('2026-05-30T00:00:00.000Z'),
      to: Date.parse('2026-05-31T00:00:00.000Z'),
    });
  });

  it('builds stable UTC month buckets', () => {
    expect(monthBucket(Date.parse('2026-05-30T12:34:00.000Z'), { mode: 'utc' })).toMatchObject({
      key: '2026-05',
      from: Date.parse('2026-05-01T00:00:00.000Z'),
      to: Date.parse('2026-06-01T00:00:00.000Z'),
    });
  });

  it('builds stable Monday-based UTC week buckets', () => {
    expect(weekBucket(Date.parse('2026-05-30T12:34:00.000Z'), { mode: 'utc' })).toMatchObject({
      key: '2026-05-25/week',
      from: Date.parse('2026-05-25T00:00:00.000Z'),
      to: Date.parse('2026-06-01T00:00:00.000Z'),
    });
  });

  it('builds local day buckets that preserve local calendar dates', () => {
    const localNoon = new Date(2026, 4, 30, 12, 34, 0, 0).getTime();

    expect(dayBucket(localNoon, { mode: 'local' })).toMatchObject({
      key: '2026-05-30',
      from: new Date(2026, 4, 30, 0, 0, 0, 0).getTime(),
      to: new Date(2026, 4, 31, 0, 0, 0, 0).getTime(),
    });
  });
});
