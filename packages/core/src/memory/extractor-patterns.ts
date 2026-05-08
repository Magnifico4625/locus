import type { DurableMemoryType } from '../types.js';

export interface ExtractorPatternMatch {
  memoryType: DurableMemoryType;
  summary: string;
  matchedPattern: string;
  confidence: number;
  reason: string;
}

interface ExtractorPattern {
  memoryType: DurableMemoryType;
  matchedPattern: string;
  confidence: number;
  reason: string;
  regex: RegExp;
  clean?: (match: RegExpMatchArray, normalized: string) => string;
}

const MIN_CONFIDENCE = 0.7;

const EXTRACTOR_PATTERNS: ExtractorPattern[] = [
  {
    memoryType: 'rejected_alternative',
    matchedPattern: 'rejected-alternative-with-rationale',
    confidence: 0.92,
    reason: 'rejected_alternative_with_rationale',
    regex: /\b(?:rejected|avoid(?:ed)?|declined)\b.+\b(?:because|due to|as)\b/i,
  },
  {
    memoryType: 'rejected_alternative',
    matchedPattern: 'ru-rejected-alternative-with-rationale',
    confidence: 0.92,
    reason: 'rejected_alternative_with_rationale',
    regex: /\b(?:отказались|отказаться|не используем|не использовать)\b.+\b(?:потому что|из за|так как)\b/iu,
  },
  {
    memoryType: 'validation_fact',
    matchedPattern: 'validation-passed',
    confidence: 0.9,
    reason: 'validation_fact',
    regex: /\b(?:validation passed|tests? passed|typecheck passed|проверка прошла|тесты прошли)\b/i,
  },
  {
    memoryType: 'next_step',
    matchedPattern: 'next-step',
    confidence: 0.86,
    reason: 'next_step',
    regex: /\b(?:next step|next i will|следующий шаг|дальше нужно)\b/i,
  },
  {
    memoryType: 'constraint',
    matchedPattern: 'explicit-constraint',
    confidence: 0.88,
    reason: 'explicit_constraint',
    regex: /\b(?:do not touch|must not|keep codex as the primary validation path|нельзя трогать|не трогать)\b/i,
  },
  {
    memoryType: 'style',
    matchedPattern: 'collaboration-style',
    confidence: 0.84,
    reason: 'collaboration_style',
    regex: /\b(?:surgical|avoid unrelated refactors|prove it with tests|хирургическ|без лишних рефакторинг)\b/i,
  },
  {
    memoryType: 'preference',
    matchedPattern: 'user-preference',
    confidence: 0.84,
    reason: 'user_preference',
    regex: /\b(?:i prefer|prefer one task at a time|предпочитаю|лучше по одному)\b/i,
  },
  {
    memoryType: 'decision',
    matchedPattern: 'decision-prefix',
    confidence: 0.9,
    reason: 'accepted_decision',
    regex: /(?:decision:|decided to|we decided|решили|мы решили)/iu,
    clean: (match, normalized) =>
      normalized.slice((match.index ?? 0) + match[0].length).replace(/^[:\s-]+/, '').trim(),
  },
  {
    memoryType: 'decision',
    matchedPattern: 'imperative-use-decision',
    confidence: 0.76,
    reason: 'accepted_decision',
    regex: /^use\s+/i,
  },
];

export function extractPatternMatches(text: string): ExtractorPatternMatch[] {
  const normalized = normalizeSentence(text);
  if (!normalized) {
    return [];
  }

  const matches: ExtractorPatternMatch[] = [];
  const seenTypes = new Set<DurableMemoryType>();

  for (const pattern of EXTRACTOR_PATTERNS) {
    if (pattern.confidence < MIN_CONFIDENCE || seenTypes.has(pattern.memoryType)) {
      continue;
    }

    const match = normalized.match(pattern.regex);
    if (!match) {
      continue;
    }

    const summary = pattern.clean?.(match, normalized) || normalized;
    if (!summary) {
      continue;
    }

    matches.push({
      memoryType: pattern.memoryType,
      summary,
      matchedPattern: pattern.matchedPattern,
      confidence: pattern.confidence,
      reason: pattern.reason,
    });
    seenTypes.add(pattern.memoryType);
  }

  return matches;
}

function normalizeSentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
