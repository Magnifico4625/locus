import type {
  MemoryRecallCandidate,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
} from '../types.js';
import { groupRecallCandidates } from './grouping.js';

export interface BuildRecallResultOptions {
  question: string;
  candidates: MemoryRecallCandidate[];
  resolvedRange?: MemoryRecallResolvedRange;
}

export function buildRecallResult({
  question,
  candidates,
  resolvedRange,
}: BuildRecallResultOptions): MemoryRecallResult {
  const candidateGroups = groupRecallCandidates(candidates);

  if (candidateGroups.length === 0) {
    return {
      status: 'no_memory',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      summary: 'No matching memory found.',
      candidates: [],
      candidateGroups: [],
    };
  }

  if (candidateGroups.length === 1) {
    const group = candidateGroups[0]!;
    return {
      status: 'ok',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      summary: group.heading,
      candidates,
      candidateGroups,
      confidence: group.confidence,
    };
  }

  return {
    status: 'needs_clarification',
    question,
    ...(resolvedRange ? { resolvedRange } : {}),
    summary: 'I found multiple possible matches. Please clarify which one you mean.',
    candidates,
    candidateGroups,
  };
}
