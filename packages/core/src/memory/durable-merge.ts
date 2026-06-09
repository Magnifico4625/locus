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

function normalizeSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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
    (entry) => normalizeSummary(entry.summary) === candidateSummary,
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
