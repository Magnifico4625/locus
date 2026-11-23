import type { DurableMemoryEntry, DurableMemoryType } from '../types.js';
import type { DurableMemoryCandidate } from './durable-extractor.js';

export type DurableMergeDecision =
  | { action: 'ignore' }
  | { action: 'confirm_existing'; existingId: number }
  | { action: 'insert_new_active' }
  | { action: 'supersede_existing'; existingId: number };

const SUPERSEDABLE_TYPES = new Set<DurableMemoryType>([
  'decision',
  'preference',
  'constraint',
  'next_step',
]);

const PARAPHRASE_STOPWORDS = new Set([
  'the',
  'for',
  'and',
  'with',
  'from',
  'that',
  'this',
  'use',
  'using',
  'used',
  'choose',
  'chosen',
  'decide',
  'decided',
  'decision',
  'keep',
  'store',
  'local',
  'previously',
  'context',
  'recorded',
  'noted',
  'для',
  'как',
  'или',
  'что',
  'это',
  'при',
  'под',
  'над',
  'без',
  'про',
  'через',
  'ранее',
  'было',
  'принято',
  'указано',
  'отмечено',
  'согласно',
  'контексте',
  'переданном',
  'системном',
  'используем',
  'использовать',
  'выбрали',
  'выбираем',
  'решили',
  'решение',
  'зафиксировал',
  'подтверждаю',
]);

function normalizeSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function stemCyrillicToken(token: string): string {
  if (!/^[а-яё]+$/u.test(token) || token.length < 5) {
    return token;
  }
  const stem = token.replace(
    /(?:ами|ями|ому|ему|ого|его|ими|ыми|ою|ею|ью|ов|ев|ей|ом|ем|ах|ях|ая|яя|ое|ее|ые|ие|ую|юю|ий|ый|ой|[аяуеиоыь])$/u,
    '',
  );
  return stem.length >= 3 ? stem : token;
}

function extractContentTokens(summary: string): Set<string> {
  const tokens = new Set<string>();
  const rawTokens = summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/u);

  for (const raw of rawTokens) {
    const trimmed = raw.replace(/^-+|-+$/gu, '');
    if (trimmed.length < 3 || PARAPHRASE_STOPWORDS.has(trimmed)) {
      continue;
    }
    const normalized = stemCyrillicToken(trimmed);
    if (normalized.length >= 3 && !PARAPHRASE_STOPWORDS.has(normalized)) {
      tokens.add(normalized);
    }
  }

  return tokens;
}

function isParaphraseDuplicate(existingSummary: string, candidateSummary: string): boolean {
  const existingTokens = extractContentTokens(existingSummary);
  const candidateTokens = extractContentTokens(candidateSummary);
  const minSize = Math.min(existingTokens.size, candidateTokens.size);
  if (minSize < 2) {
    return false;
  }

  let overlap = 0;
  for (const token of existingTokens) {
    if (candidateTokens.has(token)) {
      overlap++;
    }
  }

  return overlap === minSize;
}

function hasMappingConfidence(candidate: DurableMemoryCandidate): boolean {
  return typeof candidate.evidence.confidence === 'number';
}

function isPositiveValidationSummary(summary: string): boolean {
  const normalized = summary.toLowerCase();
  if (
    /\b(?:not|never|failed|failing|blocked|hasn['’]?t|haven['’]?t|isn['’]?t|wasn['’]?t)\b/u.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(?:passed|validated|released|published|shipped|done|completed|finished|resolved)\b/u.test(
    normalized,
  );
}

export function mergeDurableCandidate(
  existingEntries: DurableMemoryEntry[],
  candidate: DurableMemoryCandidate,
): DurableMergeDecision {
  const activeEntries = existingEntries.filter((entry) => entry.state === 'active');
  const resolvedNextStep = activeEntries.find(
    (entry) =>
      candidate.memoryType === 'validation_fact' &&
      entry.memoryType === 'next_step' &&
      candidate.topicKey &&
      entry.topicKey === candidate.topicKey &&
      isPositiveValidationSummary(candidate.summary),
  );
  if (resolvedNextStep) {
    return {
      action: 'supersede_existing',
      existingId: resolvedNextStep.id,
    };
  }

  const matchingEntries = activeEntries
    .filter((entry) => entry.memoryType === candidate.memoryType)
    .filter((entry) => (candidate.topicKey ? entry.topicKey === candidate.topicKey : true));

  const candidateSummary = normalizeSummary(candidate.summary);
  const duplicate = matchingEntries.find(
    (entry) =>
      normalizeSummary(entry.summary) === candidateSummary ||
      isParaphraseDuplicate(entry.summary, candidate.summary),
  );
  if (duplicate) {
    return {
      action: 'confirm_existing',
      existingId: duplicate.id,
    };
  }

  const firstMatchingEntry = matchingEntries[0];
  if (
    candidate.topicKey &&
    hasMappingConfidence(candidate) &&
    SUPERSEDABLE_TYPES.has(candidate.memoryType) &&
    firstMatchingEntry
  ) {
    return {
      action: 'supersede_existing',
      existingId: firstMatchingEntry.id,
    };
  }

  return { action: 'insert_new_active' };
}
