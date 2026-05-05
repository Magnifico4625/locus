import type { MemoryRecallResolvedRange } from '../types.js';

export type ParsedRecallRange = MemoryRecallResolvedRange;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_TO_UTC_DAY = new Map<string, number>([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
  ['воскресенье', 0],
  ['понедельник', 1],
  ['вторник', 2],
  ['среду', 3],
  ['среда', 3],
  ['четверг', 4],
  ['пятницу', 5],
  ['пятница', 5],
  ['субботу', 6],
  ['суббота', 6],
]);

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function range(label: string, from: number, to: number): ParsedRecallRange {
  return {
    label,
    from,
    to,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
  };
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseDaysAgo(question: string, now: number): ParsedRecallRange | undefined {
  const match =
    /\b(?<days>\d{1,3})\s+days?\s+ago\b/u.exec(question) ??
    /(?<days>\d{1,3})\s+дн(?:я|ей|ь)\s+назад/u.exec(question);

  if (!match?.groups?.days) {
    return undefined;
  }

  const days = Number(match.groups.days);
  if (!Number.isInteger(days) || days < 1) {
    return undefined;
  }

  const start = startOfUtcDay(now) - days * DAY_MS;
  return range(match[0], start, start + DAY_MS);
}

function parseWeekday(question: string, now: number): ParsedRecallRange | undefined {
  for (const [word, weekday] of WEEKDAY_TO_UTC_DAY.entries()) {
    if (!question.includes(word)) {
      continue;
    }

    const todayStart = startOfUtcDay(now);
    const currentDay = new Date(todayStart).getUTCDay();
    const delta = (currentDay - weekday + 7) % 7 || 7;
    const start = todayStart - delta * DAY_MS;
    return range(question.includes(`в ${word}`) ? `в ${word}` : word, start, start + DAY_MS);
  }

  return undefined;
}

export function parseRecallTemporalRange(
  question: string,
  now: number,
): ParsedRecallRange | undefined {
  const normalized = normalizeQuestion(question);
  const todayStart = startOfUtcDay(now);

  if (/\btoday\b/u.test(normalized) || normalized.includes('сегодня')) {
    return range(
      normalized.includes('сегодня') ? 'сегодня' : 'today',
      todayStart,
      todayStart + DAY_MS,
    );
  }

  if (/\byesterday\b/u.test(normalized) || normalized.includes('вчера')) {
    return range(
      normalized.includes('вчера') ? 'вчера' : 'yesterday',
      todayStart - DAY_MS,
      todayStart,
    );
  }

  if (normalized.includes('last week') || normalized.includes('на прошлой неделе')) {
    return range(
      normalized.includes('на прошлой неделе') ? 'на прошлой неделе' : 'last week',
      now - 7 * DAY_MS,
      now,
    );
  }

  return parseDaysAgo(normalized, now) ?? parseWeekday(normalized, now);
}
