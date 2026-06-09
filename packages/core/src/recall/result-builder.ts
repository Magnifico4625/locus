import type {
  MemoryDateBucket,
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
  searchedDateBuckets?: MemoryDateBucket[];
  matchedIntent?: MemoryRecallIntent;
  matchedTopics?: string[];
}

const DOMINANT_GROUP_SCORE_GAP = 3;

function topScore(candidate: MemoryRecallCandidate | undefined): number {
  return candidate?.score ?? 0;
}

function isDominantTopGroup(candidates: MemoryRecallCandidate[]): boolean {
  const topCandidate = candidates[0];
  if (!topCandidate) {
    return false;
  }

  const topGroupKey = groupKey(topCandidate);
  const nextDifferentGroup = candidates.find((candidate) => groupKey(candidate) !== topGroupKey);
  const scoreGap = topScore(topCandidate) - topScore(nextDifferentGroup);
  if (topCandidate.confidence === 'high') {
    return scoreGap >= DOMINANT_GROUP_SCORE_GAP;
  }

  return (
    topCandidate.sourceKind === 'durable' && topCandidate.confidence === 'medium' && scoreGap >= 3
  );
}

function groupKey(candidate: MemoryRecallCandidate): string {
  if (candidate.topicKey) {
    return `topic:${candidate.topicKey}`;
  }
  if (candidate.sessionId) {
    return `session:${candidate.sessionId}`;
  }
  if (candidate.durableMemoryIds[0] !== undefined) {
    return `durable:${candidate.durableMemoryIds[0]}`;
  }
  return `event:${candidate.eventIds[0] ?? 'unknown'}`;
}

export function buildRecallResult({
  question,
  candidates,
  resolvedRange,
  searchedDateBuckets,
  matchedIntent,
  matchedTopics,
}: BuildRecallResultOptions): MemoryRecallResult {
  const candidateGroups = groupRecallCandidates(candidates);
  const resultMetadata = {
    ...(matchedIntent ? { matchedIntent } : {}),
    ...(matchedTopics && matchedTopics.length > 0 ? { matchedTopics } : {}),
    ...(searchedDateBuckets ? { searchedDateBuckets } : {}),
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
    const group = candidateGroups[0];
    if (!group) {
      throw new Error('Expected a recall candidate group.');
    }

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

  const topCandidate = candidates[0];
  if (topCandidate && isDominantTopGroup(candidates)) {
    return {
      status: 'ok',
      question,
      ...(resolvedRange ? { resolvedRange } : {}),
      ...resultMetadata,
      summary: topCandidate.headline,
      candidates,
      candidateGroups,
      confidence: topCandidate.confidence,
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
