import type {
  DatabaseAdapter,
  DurableMemoryState,
  DurableReviewCandidate,
  DurableReviewResult,
} from '../types.js';
import { reviewDurableMemories } from '../memory/review.js';

export interface ReviewDeps {
  db: DatabaseAdapter;
}

export interface ReviewOptions {
  state?: DurableMemoryState;
  topicKey?: string;
  limit?: number;
}

export function handleReview(deps: ReviewDeps, options: ReviewOptions = {}): DurableReviewResult {
  const effectiveLimit = Math.max(1, options.limit ?? 20);
  const review = reviewDurableMemories(deps, { limit: 1000 });

  const filtered = review.candidates
    .filter((candidate) => (options.state ? candidate.state === options.state : true))
    .filter((candidate) => (options.topicKey ? candidate.topicKey === options.topicKey : true))
    .slice(0, effectiveLimit);

  return {
    totalCandidates: filtered.length,
    countsByState: review.countsByState,
    candidates: filtered.map((candidate): DurableReviewCandidate => ({ ...candidate })),
  };
}
