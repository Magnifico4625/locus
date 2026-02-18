import type { Confidence, FileEntry } from '../types.js';

export function computeConfidence(_entry: Partial<FileEntry>): Confidence {
  // TODO: implement confidence scoring
  return { level: 'high' };
}
