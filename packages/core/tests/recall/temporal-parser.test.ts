import { describe, expect, it } from 'vitest';
import { parseRecallTemporalRange } from '../../src/recall/temporal-parser.js';

const now = Date.parse('2026-05-04T12:00:00.000Z');

describe('parseRecallTemporalRange', () => {
  it.each([
    ['what did we do today?', 'today', '2026-05-04T00:00:00.000Z', '2026-05-05T00:00:00.000Z'],
    [
      'what did we do yesterday?',
      'yesterday',
      '2026-05-03T00:00:00.000Z',
      '2026-05-04T00:00:00.000Z',
    ],
    [
      'what did we do last week?',
      'last week',
      '2026-04-27T12:00:00.000Z',
      '2026-05-04T12:00:00.000Z',
    ],
    [
      'what happened 5 days ago?',
      '5 days ago',
      '2026-04-29T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
    ],
    ['что делали сегодня?', 'сегодня', '2026-05-04T00:00:00.000Z', '2026-05-05T00:00:00.000Z'],
    ['что делали вчера?', 'вчера', '2026-05-03T00:00:00.000Z', '2026-05-04T00:00:00.000Z'],
    [
      'что делали на прошлой неделе?',
      'на прошлой неделе',
      '2026-04-27T12:00:00.000Z',
      '2026-05-04T12:00:00.000Z',
    ],
    [
      'что было 5 дней назад?',
      '5 дней назад',
      '2026-04-29T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
    ],
    ['что делали в пятницу?', 'в пятницу', '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z'],
  ])('parses %s', (question, label, fromIso, toIso) => {
    expect(parseRecallTemporalRange(question, now, { mode: 'utc' })).toMatchObject({
      label,
      from: Date.parse(fromIso),
      to: Date.parse(toIso),
      fromIso,
      toIso,
    });
  });

  it.each([
    [
      'вспомни работу в этом месяце',
      'в этом месяце',
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ],
    [
      'what did we do this month?',
      'this month',
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ],
    ['что делали в мае?', 'май 2026', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
    [
      'what happened in April?',
      'april 2026',
      '2026-04-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ],
  ])('parses period query %s', (question, label, fromIso, toIso) => {
    const may30 = Date.parse('2026-05-30T12:00:00.000Z');

    expect(parseRecallTemporalRange(question, may30, { mode: 'utc' })).toEqual({
      label,
      from: Date.parse(fromIso),
      to: Date.parse(toIso),
      fromIso,
      toIso,
      granularity: 'month',
    });
  });

  it('returns undefined when no temporal phrase is present', () => {
    expect(
      parseRecallTemporalRange('what did we decide about auth?', now, { mode: 'utc' }),
    ).toBeUndefined();
  });
});
