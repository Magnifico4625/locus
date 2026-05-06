import type {
  MemoryRecallIntent,
  MemoryRecallResolvedRange,
} from '../types.js';
import { parseRecallTemporalRange } from './temporal-parser.js';

export interface ParsedRecallQuery {
  original: string;
  normalized: string;
  normalizedTerms: string[];
  terms: string[];
  termVariants: string[];
  intent: MemoryRecallIntent;
  temporalRange?: MemoryRecallResolvedRange;
  topicHints: string[];
}

const STOP_WORDS = new Set([
  'a',
  'about',
  'and',
  'did',
  'do',
  'decide',
  'decided',
  'during',
  'happened',
  'is',
  'just',
  'last',
  'me',
  'my',
  'the',
  'to',
  'we',
  'what',
  'which',
  'why',
  'yesterday',
  'были',
  'было',
  'делали',
  'какие',
  'какой',
  'меня',
  'мы',
  'на',
  'назад',
  'неделе',
  'осталось',
  'почему',
  'при',
  'про',
  'прошлой',
  'расскажи',
  'реально',
  'решили',
  'сделать',
  'сегодня',
  'что',
  'вчера',
]);

const INTENT_PATTERNS: Array<{
  intent: MemoryRecallIntent;
  patterns: RegExp[];
}> = [
  {
    intent: 'rejected_alternative',
    patterns: [/\bwhy\b.*\breject(?:ed)?\b/u, /\bwhy\s+not\b/u, /почему\s+отказал/u],
  },
  {
    intent: 'validation_fact',
    patterns: [/\b(?:passed|validation|verified|checked)\b/u, /проверен|проверено/u],
  },
  {
    intent: 'next_step',
    patterns: [/\b(?:what\s+remains|next\s+steps?|todo)\b/u, /что\s+осталось|следующ/u],
  },
  {
    intent: 'preference_style',
    patterns: [/\b(?:my\s+)?(?:code\s+)?style\b/u, /\bpreferences?\b/u, /стиль|предпочтен/u],
  },
  {
    intent: 'bug_context',
    patterns: [
      /\b(?:errors?|failures?|bugs?|failed|failing|fix(?:ed|es)?)\b/u,
      /ошибк|падал|сломал|исправил/u,
    ],
  },
  {
    intent: 'decision',
    patterns: [/\bdecid(?:e|ed)\b/u, /что\s+решили|решили\s+по/u],
  },
  {
    intent: 'work_summary',
    patterns: [/\bwhat\s+did\s+we\s+do\b/u, /что\s+(?:мы\s+)?делали/u],
  },
];

const TOPIC_HINTS: Array<{ topic: string; patterns: RegExp[] }> = [
  { topic: 'auth_strategy', patterns: [/\bauth\b/u, /\boauth\b/u, /авторизац/u] },
  { topic: 'capture_strategy', patterns: [/\bcapture\s+strategy\b/u, /capture\s+mode/u] },
  { topic: 'codex_hooks_strategy', patterns: [/\bhook-first\b/u, /\bcodex\s+hooks?\b/u] },
  { topic: 'package_installation', patterns: [/\bnpm\s+install\b/u, /\binstall\b/u] },
];

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stemLite(term: string): string {
  if (/^ошиб(?:ка|ки|ку|ке|кой|ок|ками)?$/u.test(term)) {
    return 'ошибк';
  }

  return term;
}

function detectIntent(normalized: string): MemoryRecallIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return intent;
    }
  }

  return 'general';
}

function detectTopicHints(normalized: string): string[] {
  return TOPIC_HINTS.filter(({ patterns }) =>
    patterns.some((pattern) => pattern.test(normalized)),
  ).map(({ topic }) => topic);
}

export function parseRecallQuery(question: string, now: number): ParsedRecallQuery {
  const normalized = normalizeQuestion(question);
  const normalizedTerms = normalized.length > 0 ? normalized.split(' ') : [];
  const terms = normalizedTerms.filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
  const termVariants = unique(terms.map(stemLite));
  const temporalRange = parseRecallTemporalRange(question, now);

  return {
    original: question,
    normalized,
    normalizedTerms,
    terms,
    termVariants,
    intent: detectIntent(normalized),
    ...(temporalRange ? { temporalRange } : {}),
    topicHints: detectTopicHints(normalized),
  };
}
