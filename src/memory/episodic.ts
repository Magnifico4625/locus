import type { MemoryEntry } from '../types.js';

export class EpisodicMemory {
  addEvent(_content: string, _sessionId: string): MemoryEntry {
    throw new Error('Not implemented');
  }

  getRecent(_limit: number): MemoryEntry[] {
    return [];
  }
}
