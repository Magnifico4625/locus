import type { DurableMemoryEntry } from '../types.js';
import type { DurableMemoryCandidate } from './durable-extractor.js';

export type DurableMergeDecision =
  | { action: 'ignore' }
  | { action: 'confirm_existing'; existingId: number }
  | { action: 'insert_new_active' }
  | { action: 'supersede_existing'; existingId: number };

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9]+/gi, ' ').trim();
}

export function mergeDurableCandidate(
  existingEntries: DurableMemoryEntry[],
  candidate: DurableMemoryCandidate,
): DurableMergeDecision {
  const activeEntries = existingEntries.filter((entry) => entry.state === 'active');
  const matchingTopic = candidate.topicKey
    ? activeEntries.filter((entry) => entry.topicKey === candidate.topicKey)
    : activeEntries.filter((entry) => entry.memoryType === candidate.memoryType);

  const candidateSummary = normalizeSummary(candidate.summary);
  const duplicate = matchingTopic.find((entry) => normalizeSummary(entry.summary) === candidateSummary);
  if (duplicate) {
    return {
      action: 'confirm_existing',
      existingId: duplicate.id,
    };
  }

  if (candidate.memoryType === 'decision' && matchingTopic.length > 0) {
    return {
      action: 'supersede_existing',
      existingId: matchingTopic[0].id,
    };
  }

  return { action: 'insert_new_active' };
}
