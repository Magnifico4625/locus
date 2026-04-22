import type {
  DatabaseAdapter,
  DurableMemoryEntry,
  DurableMemoryStateCounts,
  DurableReviewCandidate,
  DurableReviewResult,
} from '../types.js';
import { DurableMemoryStore } from './durable.js';

export interface ReviewDurableMemoriesDeps {
  db: DatabaseAdapter;
}

export interface ReviewDurableMemoriesOptions {
  limit?: number;
}

function createEmptyStateCounts(): DurableMemoryStateCounts {
  return {
    active: 0,
    stale: 0,
    superseded: 0,
    archivable: 0,
  };
}

function buildCandidate(entry: DurableMemoryEntry): DurableReviewCandidate | null {
  if (entry.state === 'superseded') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      state: entry.state,
      reason: 'superseded_by_newer_memory',
      recommendedAction: 'delete',
      summary: entry.summary,
      supersededById: entry.supersededById,
      updatedAt: entry.updatedAt,
    };
  }

  if (entry.state === 'stale') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      state: entry.state,
      reason: 'stale_low_value',
      recommendedAction: 'review',
      summary: entry.summary,
      supersededById: entry.supersededById,
      updatedAt: entry.updatedAt,
    };
  }

  if (entry.state === 'archivable') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      state: entry.state,
      reason: 'aged_but_readable',
      recommendedAction: 'archive',
      summary: entry.summary,
      supersededById: entry.supersededById,
      updatedAt: entry.updatedAt,
    };
  }

  return null;
}

export function reviewDurableMemories(
  deps: ReviewDurableMemoriesDeps,
  options?: ReviewDurableMemoriesOptions,
): DurableReviewResult {
  const limit = options?.limit ?? 100;
  const store = new DurableMemoryStore(deps.db, false);
  const entries = store.listAll(limit);
  const countsByState = entries.length > 0 ? store.countByState() : createEmptyStateCounts();
  const candidates = entries
    .map((entry) => buildCandidate(entry))
    .filter((candidate): candidate is DurableReviewCandidate => candidate !== null)
    .slice(0, limit);

  return {
    totalCandidates: candidates.length,
    countsByState,
    candidates,
  };
}
