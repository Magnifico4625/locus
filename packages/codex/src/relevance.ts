export type CodexRelevanceReason =
  | 'noise'
  | 'bug_context'
  | 'decision'
  | 'preference'
  | 'next_step'
  | 'general_context';

export interface CodexRelevanceResult {
  keep: boolean;
  reason: CodexRelevanceReason;
}

export type CodexSpeakerRole = 'user' | 'assistant';

const NOISE_PATTERNS = [
  /\bfor general learning\b/i,
  /\bexplain what\b/i,
  /\bhistory of\b/i,
  /\bcompare\b/i,
  /\bwhat are\b/i,
];

const BUG_PATTERNS = [
  /\bbug\b/i,
  /\bcrash(?:es|ed|ing)?\b/i,
  /\bfail(?:s|ed|ing|ure)?\b/i,
  /\berror\b/i,
  /\bregression\b/i,
  /\brefactor\b/i,
  /\bnull(?:able)?\b/i,
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
  /\bchoose\b/i,
  /\bkeep the fix\b/i,
  /\bpatch\b.{0,24}\bfirst\b/i,
  /\bstrategy\b/i,
];

export function classifyCodexRelevance(text: string, role: CodexSpeakerRole): CodexRelevanceResult {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return { keep: false, reason: 'noise' };
  }

  if (role === 'assistant' && matchesAny(normalized, NEXT_STEP_PATTERNS)) {
    return { keep: true, reason: 'next_step' };
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

  return { keep: true, reason: 'general_context' };
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
