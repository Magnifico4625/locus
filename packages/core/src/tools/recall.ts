import { runRecallEngine } from '../recall/index.js';
import type { DatabaseAdapter, MemoryRecallResult, TimeRange } from '../types.js';

interface RecallDeps {
  db: DatabaseAdapter;
  now?: number;
}

export interface RecallOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
}

export function handleRecall(
  question: string,
  deps: RecallDeps,
  options?: RecallOptions,
): MemoryRecallResult {
  return runRecallEngine(question, deps, options);
}
