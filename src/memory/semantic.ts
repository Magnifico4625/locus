import type { MemoryEntry } from '../types.js';

export class SemanticMemory {
  add(_content: string, _tags: string[]): MemoryEntry {
    throw new Error('Not implemented');
  }

  search(_query: string): MemoryEntry[] {
    return [];
  }

  remove(_id: number): boolean {
    return false;
  }
}
