import { reviewDurableMemories } from '../memory/review.js';
import type {
  DatabaseAdapter,
  DurableMemoryState,
  DurableMemoryType,
  DurableReviewCandidate,
  DurableReviewResult,
} from '../types.js';

export interface ReviewDeps {
  db: DatabaseAdapter;
}

export interface ReviewOptions {
  state?: DurableMemoryState;
  topicKey?: string;
  memoryType?: DurableMemoryType;
  confidence?: number;
  limit?: number;
}

export function handleReview(deps: ReviewDeps, options: ReviewOptions = {}): DurableReviewResult {
  const effectiveLimit = Math.max(1, options.limit ?? 20);
  const review = reviewDurableMemories(deps, {
    state: options.state,
    topicKey: options.topicKey,
    memoryType: options.memoryType,
    confidence: options.confidence,
    limit: 1000,
  });

  const filtered = review.candidates.slice(0, effectiveLimit);

  return {
    totalCandidates: filtered.length,
    returnedCandidates: filtered.length,
    totalMatchingCandidates: review.candidates.length,
    countsByState: review.countsByState,
    candidates: filtered.map((candidate): DurableReviewCandidate => ({ ...candidate })),
  };
}
