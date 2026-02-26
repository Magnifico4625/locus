import type { LocusConfig } from '../types.js';
import { estimateTokens } from '../utils.js';

export class MemoryCompressor {
  private readonly config: LocusConfig;

  constructor(config: LocusConfig) {
    this.config = config;
  }

  shouldCompress(bufferTokens: number): boolean {
    switch (this.config.compressionMode) {
      case 'manual':
        return false;
      case 'aggressive':
        return bufferTokens > 0;
      default:
        return bufferTokens > this.config.compressionThreshold;
    }
  }

  compress(entries: string[]): string {
    if (entries.length === 0) return '';

    const budget = Math.floor(this.config.compressionThreshold / 2);

    // Collect entries from the end (most recent) until the token budget is exhausted.
    const kept: string[] = [];
    let usedTokens = 0;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] ?? '';
      const entryTokens = estimateTokens(entry);
      if (usedTokens + entryTokens > budget && kept.length > 0) {
        break;
      }
      kept.unshift(entry);
      usedTokens += entryTokens;
    }

    const result = kept.join('\n');

    // If the single kept entry still exceeds the budget, truncate it.
    if (estimateTokens(result) > budget) {
      return result.slice(0, budget * 4);
    }

    return result;
  }
}
