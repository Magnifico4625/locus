import type {
  DatabaseAdapter,
  DurableMemoryEntry,
  DurableMemoryState,
  DurableMemoryStateCounts,
  DurableMemoryType,
  DurableReviewCandidate,
  DurableReviewResult,
} from '../types.js';
import { DurableMemoryStore } from './durable.js';
import { formatEvidenceWhyStored, normalizeDurableEvidence } from './evidence.js';

export interface ReviewDurableMemoriesDeps {
  db: DatabaseAdapter;
}

export interface ReviewDurableMemoriesOptions {
  state?: DurableMemoryState;
  topicKey?: string;
  memoryType?: DurableMemoryType;
  confidence?: number;
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
  const evidence = normalizeDurableEvidence(entry.evidence);
  const sourceEventId = entry.sourceEventId ?? evidence.sourceEventId;
  const whyStored = formatEvidenceWhyStored(entry.memoryType, {
    ...evidence,
    sourceEventId,
  });

  if (entry.state === 'superseded') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      memoryType: entry.memoryType,
      state: entry.state,
      reason: 'superseded_by_newer_memory',
      recommendedAction: 'delete',
      summary: entry.summary,
      confidence: evidence.confidence,
      sourceEventId,
      whyStored,
      supersededById: entry.supersededById,
      updatedAt: entry.updatedAt,
    };
  }

  if (entry.state === 'stale') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      memoryType: entry.memoryType,
      state: entry.state,
      reason: 'stale_low_value',
      recommendedAction: 'review',
      summary: entry.summary,
      confidence: evidence.confidence,
      sourceEventId,
      whyStored,
      supersededById: entry.supersededById,
      updatedAt: entry.updatedAt,
    };
  }

  if (entry.state === 'archivable') {
    return {
      durableId: entry.id,
      topicKey: entry.topicKey,
      memoryType: entry.memoryType,
      state: entry.state,
      reason: 'aged_but_readable',
      recommendedAction: 'archive',
      summary: entry.summary,
      confidence: evidence.confidence,
      sourceEventId,
      whyStored,
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
    .filter((entry) => (options?.state ? entry.state === options.state : true))
    .filter((entry) => (options?.topicKey ? entry.topicKey === options.topicKey : true))
    .filter((entry) => (options?.memoryType ? entry.memoryType === options.memoryType : true))
    .map((entry) => buildCandidate(entry))
    .filter((candidate): candidate is DurableReviewCandidate => candidate !== null)
    .filter((candidate) =>
      typeof options?.confidence === 'number'
        ? typeof candidate.confidence === 'number' && candidate.confidence >= options.confidence
        : true,
    )
    .slice(0, limit);

  return {
    totalCandidates: candidates.length,
    returnedCandidates: candidates.length,
    totalMatchingCandidates: candidates.length,
    countsByState,
    candidates,
  };
}
