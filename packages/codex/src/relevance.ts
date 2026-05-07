import type { CodexCaptureReason } from './types.js';

export type CodexRelevanceReason = CodexCaptureReason;

export interface CodexRelevanceResult {
  keep: boolean;
  reason: CodexRelevanceReason;
}

export type CodexSpeakerRole = 'user' | 'assistant';

const NOISE_PATTERNS = [
  /\bfor general learning\b/i,
  /\bexplain what\b/i,
  /\bin general terms\b/i,
  /\bhistory of\b/i,
  /\bcompare\b/i,
  /\bwhat are\b/i,
  /что\s+такое/i,
  /для\s+общего\s+развития/i,
  /рассказать\s+подробнее/i,
];

const BUG_PATTERNS = [
  /\bbug\b/i,
  /\bcrash(?:es|ed|ing)?\b/i,
  /\bfail(?:s|ed|ing|ure)?\b/i,
  /\berror\b/i,
  /\bfix(?:ed|es|ing)?\b/i,
  /\bregression\b/i,
  /\brefactor\b/i,
  /\bnull(?:able)?\b/i,
  /\broot\s+cause\b/i,
  /\brecall\s+gap\b/i,
  /пада(?:ет|л|ют)/i,
  /ошибк/i,
  /регрес/i,
  /рефактор/i,
  /причин[ау]/i,
  /не\s+сохранял/i,
];

const PREFERENCE_PATTERNS = [
  /\bprefer\b/i,
  /\bkeep\b.{0,24}\bsurgical\b/i,
  /\bdo not touch\b/i,
  /\bdon't touch\b/i,
  /\bavoid touching\b/i,
  /\bunrelated modules?\b/i,
  /\bunrelated code\b/i,
];

const STYLE_PATTERNS = [
  /\bmy\s+style\b/i,
  /\bcode\s+style\b/i,
  /\bshort\s+direct\s+progress\s+reports\b/i,
  /\bapproval\s+gates?\b/i,
  /мой\s+стиль/i,
  /стиль\s+работы/i,
  /коротк(?:ие|их)\s+отчет/i,
  /после\s+одобрения/i,
];

const CONSTRAINT_PATTERNS = [
  /\bconstraint\b/i,
  /\bmust\s+not\b/i,
  /\bdo\s+not\s+modify\b/i,
  /ограничени[ея]/i,
  /не\s+трогай/i,
];

const REJECTED_ALTERNATIVE_PATTERNS = [
  /\breject(?:ed)?\b/i,
  /\bdecided\s+against\b/i,
  /\bnot\s+stable\s+enough\b/i,
  /отказал(?:ись|и)?/i,
  /не\s+подош[её]л/i,
];

const VALIDATION_FACT_PATTERNS = [
  /\bvalidation\s+passed\b/i,
  /\btests?\s+passed\b/i,
  /\btypecheck\b.{0,24}\b(?:green|passed)\b/i,
  /\bgreen\b/i,
  /проверено/i,
  /прош[её]л/i,
  /зел[её]н/i,
];

const NEXT_STEP_PATTERNS = [
  /\bnext\b.{0,24}\b(i|we)\b.{0,24}\bwill\b/i,
  /\bi will add\b/i,
  /\bi will run\b/i,
  /\bi will wire\b/i,
  /\bthen run\b/i,
];

const DECISION_PATTERNS = [
  /\bdecision\b/i,
  /\bdecide(?:d)?\b/i,
  /\buse\s+[a-z0-9_-]+/i,
  /\bchoose\b/i,
  /\bkeep the fix\b/i,
  /\bpatch\b.{0,24}\bfirst\b/i,
  /\bstrategy\b/i,
  /решили/i,
  /выбрали/i,
  /использовать/i,
];

export function classifyCodexRelevance(text: string, role: CodexSpeakerRole): CodexRelevanceResult {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return { keep: false, reason: 'noise' };
  }

  if (role === 'assistant' && matchesAny(normalized, NEXT_STEP_PATTERNS)) {
    return { keep: true, reason: 'next_step' };
  }

  if (matchesAny(normalized, REJECTED_ALTERNATIVE_PATTERNS)) {
    return { keep: true, reason: 'rejected_alternative' };
  }

  if (matchesAny(normalized, VALIDATION_FACT_PATTERNS)) {
    return { keep: true, reason: 'validation_fact' };
  }

  if (matchesAny(normalized, CONSTRAINT_PATTERNS)) {
    return { keep: true, reason: 'constraint' };
  }

  if (matchesAny(normalized, STYLE_PATTERNS)) {
    return { keep: true, reason: 'style' };
  }

  if (matchesAny(normalized, PREFERENCE_PATTERNS)) {
    return { keep: true, reason: 'preference' };
  }

  if (matchesAny(normalized, BUG_PATTERNS)) {
    return { keep: true, reason: 'bug_context' };
  }

  if (matchesAny(normalized, DECISION_PATTERNS)) {
    return { keep: true, reason: 'decision' };
  }

  if (matchesAny(normalized, NOISE_PATTERNS)) {
    return { keep: false, reason: 'noise' };
  }

  if (role === 'assistant') {
    return { keep: false, reason: 'noise' };
  }

  return { keep: true, reason: 'general_context' };
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
