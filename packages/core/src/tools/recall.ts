import { runRecallEngine } from '../recall/index.js';
import type { DatabaseAdapter, MemoryRecallResult, TimeRange } from '../types.js';

interface RecallDeps {
  db: DatabaseAdapter;
  now?: number;
  projectRoot?: string;
}

export interface RecallOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
  temporalMode?: 'local' | 'utc';
}

export function handleRecall(
  question: string,
  deps: RecallDeps,
  options?: RecallOptions,
): MemoryRecallResult {
  return runRecallEngine(question, deps, options);
}
