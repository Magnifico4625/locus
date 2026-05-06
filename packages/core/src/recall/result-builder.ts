import type {
  MemoryRecallCandidate,
  MemoryRecallIntent,
  MemoryRecallResolvedRange,
  MemoryRecallResult,
} from '../types.js';
import { groupRecallCandidates } from './grouping.js';

export interface BuildRecallResultOptions {
  question: string;
  candidates: MemoryRecallCandidate[];
  resolvedRange?: MemoryRecallResolvedRange;
  matchedIntent?: MemoryRecallIntent;
  matchedTopics?: string[];
}

export function buildRecallResult({
  question,
  candidates,
  resolvedRange,
  matchedIntent,
  matchedTopics,
}: BuildRecallResultOptions): MemoryRecallResult {
  const candidateGroups = groupRecallCandidates(candidates);
  const resultMetadata = {
    ...(matchedIntent ? { matchedIntent } : {}),
    ...(matchedTopics && matchedTopics.length > 0 ? { matchedTopics } : {}),
  };

  if (candidateGroups.length === 0) {
    return {
      status: 'no_memory',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      ...resultMetadata,
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
      ...resultMetadata,
      summary: group.candidates[0]?.headline ?? group.heading,
      candidates,
      candidateGroups,
      confidence: group.confidence,
    };
  }

  return {
    status: 'needs_clarification',
    question,
    ...(resolvedRange ? { resolvedRange } : {}),
    ...resultMetadata,
    summary: 'I found multiple possible matches. Please clarify which one you mean.',
    candidates,
    candidateGroups,
  };
}
