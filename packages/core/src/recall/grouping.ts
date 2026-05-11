import type {
  MemoryRecallCandidate,
  MemoryRecallCandidateGroup,
  MemoryRecallConfidence,
} from '../types.js';

const MAX_HEADING_LENGTH = 80;

function groupId(candidate: MemoryRecallCandidate, index: number): string {
  const topicPart = candidate.topicKey ? `:topic:${candidate.topicKey}` : '';
  if (candidate.sessionId) {
    return `session:${candidate.sessionId}${topicPart}`;
  }

  const durableId = candidate.durableMemoryIds[0];
  if (durableId !== undefined) {
    return `durable:${durableId}${topicPart}`;
  }

  const eventId = candidate.eventIds[0];
  if (eventId !== undefined) {
    return `event:${eventId}${topicPart}`;
  }

  return `candidate:${index}${topicPart}`;
}

function clipHeading(headline: string): string {
  if (headline.length <= MAX_HEADING_LENGTH) {
    return headline;
  }

  return `${headline.slice(0, MAX_HEADING_LENGTH - 3)}...`;
}

function mergeUnique<T>(left: T[], right: T[]): T[] {
  return [...new Set([...left, ...right])];
}

function maxConfidence(
  left: MemoryRecallConfidence | undefined,
  right: MemoryRecallConfidence | undefined,
): MemoryRecallConfidence | undefined {
  const rank: Record<MemoryRecallConfidence, number> = { low: 0, medium: 1, high: 2 };
  if (!left) return right;
  if (!right) return left;
  return rank[right] > rank[left] ? right : left;
}

export function groupRecallCandidates(
  candidates: MemoryRecallCandidate[],
): MemoryRecallCandidateGroup[] {
  const groups = new Map<string, MemoryRecallCandidateGroup>();

  candidates.forEach((candidate, index) => {
    const id = groupId(candidate, index);
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, {
        id,
        heading: clipHeading(candidate.headline),
        whyMatched: candidate.whyMatched,
        candidates: [candidate],
        eventIds: [...candidate.eventIds],
        durableMemoryIds: [...candidate.durableMemoryIds],
        ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {}),
        ...(candidate.topicKey ? { topicKey: candidate.topicKey } : {}),
        ...(candidate.confidence ? { confidence: candidate.confidence } : {}),
      });
      return;
    }

    existing.candidates.push(candidate);
    existing.eventIds = mergeUnique(existing.eventIds, candidate.eventIds);
    existing.durableMemoryIds = mergeUnique(existing.durableMemoryIds, candidate.durableMemoryIds);
    existing.confidence = maxConfidence(existing.confidence, candidate.confidence);
  });

  return [...groups.values()];
}
