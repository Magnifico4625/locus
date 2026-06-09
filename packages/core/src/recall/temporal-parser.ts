import type { MemoryRecallResolvedRange } from '../types.js';
import { dayBucket, monthBucket } from './calendar.js';

export type ParsedRecallRange = MemoryRecallResolvedRange;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS_EN = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_LABELS_RU = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];
const MONTH_NAMES = new Map<string, number>([
  ['january', 0],
  ['february', 1],
  ['march', 2],
  ['april', 3],
  ['may', 4],
  ['june', 5],
  ['july', 6],
  ['august', 7],
  ['september', 8],
  ['october', 9],
  ['november', 10],
  ['december', 11],
  ['январ', 0],
  ['феврал', 1],
  ['март', 2],
  ['апрел', 3],
  ['май', 4],
  ['мае', 4],
  ['мая', 4],
  ['июн', 5],
  ['июл', 6],
  ['август', 7],
  ['сентябр', 8],
  ['октябр', 9],
  ['ноябр', 10],
  ['декабр', 11],
]);
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

export interface RecallTemporalParseOptions {
  mode?: 'local' | 'utc';
}

function range(
  label: string,
  from: number,
  to: number,
  granularity?: MemoryRecallResolvedRange['granularity'],
): ParsedRecallRange {
  return {
    label,
    from,
    to,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    ...(granularity ? { granularity } : {}),
  };
}

function normalizeQuestion(question: string): string {
  return question.toLowerCase().replace(/\s+/g, ' ').trim();
}

function currentYear(now: number, mode: 'local' | 'utc'): number {
  const date = new Date(now);
  return mode === 'utc' ? date.getUTCFullYear() : date.getFullYear();
}

function startOfMonthFor(
  year: number,
  month: number,
  mode: 'local' | 'utc',
): { from: number; to: number } {
  if (mode === 'utc') {
    return {
      from: Date.UTC(year, month, 1),
      to: Date.UTC(year, month + 1, 1),
    };
  }

  return {
    from: new Date(year, month, 1).getTime(),
    to: new Date(year, month + 1, 1).getTime(),
  };
}

function hasMonthWord(question: string, monthWord: string): boolean {
  const escaped = monthWord.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}\\p{L}*(?=$|[^\\p{L}])`, 'u').test(question);
}

function parseMonthPhrase(
  question: string,
  now: number,
  mode: 'local' | 'utc',
): ParsedRecallRange | undefined {
  if (/\bthis\s+month\b/u.test(question) || question.includes('в этом месяце')) {
    const bucket = monthBucket(now, { mode });
    return range(
      question.includes('в этом месяце') ? 'в этом месяце' : 'this month',
      bucket.from,
      bucket.to,
      'month',
    );
  }

  const explicitYear = /\b(?<year>19\d{2}|20\d{2})\b/u.exec(question)?.groups?.year;
  const year = explicitYear ? Number(explicitYear) : currentYear(now, mode);

  for (const [monthWord, month] of MONTH_NAMES.entries()) {
    if (!hasMonthWord(question, monthWord)) {
      continue;
    }

    const { from, to } = startOfMonthFor(year, month, mode);
    const isEnglish = /^[a-z]/u.test(monthWord);
    const label = `${isEnglish ? MONTH_LABELS_EN[month] : MONTH_LABELS_RU[month]} ${year}`;
    return range(label, from, to, 'month');
  }

  return undefined;
}

function parseDaysAgo(
  question: string,
  now: number,
  mode: 'local' | 'utc',
): ParsedRecallRange | undefined {
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

  const start = dayBucket(now, { mode }).from - days * DAY_MS;
  return range(match[0], start, start + DAY_MS, 'day');
}

function parseWeekday(
  question: string,
  now: number,
  mode: 'local' | 'utc',
): ParsedRecallRange | undefined {
  for (const [word, weekday] of WEEKDAY_TO_UTC_DAY.entries()) {
    if (!question.includes(word)) {
      continue;
    }

    const todayStart = dayBucket(now, { mode }).from;
    const today = new Date(todayStart);
    const currentDay = mode === 'utc' ? today.getUTCDay() : today.getDay();
    const delta = (currentDay - weekday + 7) % 7 || 7;
    const start = todayStart - delta * DAY_MS;
    return range(question.includes(`в ${word}`) ? `в ${word}` : word, start, start + DAY_MS, 'day');
  }

  return undefined;
}

export function parseRecallTemporalRange(
  question: string,
  now: number,
  options?: RecallTemporalParseOptions,
): ParsedRecallRange | undefined {
  const mode = options?.mode ?? 'local';
  const normalized = normalizeQuestion(question);
  const todayStart = dayBucket(now, { mode }).from;

  if (/\btoday\b/u.test(normalized) || normalized.includes('сегодня')) {
    return range(
      normalized.includes('сегодня') ? 'сегодня' : 'today',
      todayStart,
      todayStart + DAY_MS,
      'day',
    );
  }

  if (/\byesterday\b/u.test(normalized) || normalized.includes('вчера')) {
    return range(
      normalized.includes('вчера') ? 'вчера' : 'yesterday',
      todayStart - DAY_MS,
      todayStart,
      'day',
    );
  }

  if (normalized.includes('last week') || normalized.includes('на прошлой неделе')) {
    return range(
      normalized.includes('на прошлой неделе') ? 'на прошлой неделе' : 'last week',
      now - 7 * DAY_MS,
      now,
    );
  }

  return (
    parseMonthPhrase(normalized, now, mode) ??
    parseDaysAgo(normalized, now, mode) ??
    parseWeekday(normalized, now, mode)
  );
}
