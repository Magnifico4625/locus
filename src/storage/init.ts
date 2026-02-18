import type { DatabaseAdapter } from '../types.js';

export interface StorageInit {
  db: DatabaseAdapter;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
}

export async function initStorage(_dbPath: string): Promise<StorageInit> {
  // TODO: implement detection + fallback chain
  throw new Error('Not implemented');
}

export function detectFts5(_db: DatabaseAdapter): boolean {
  // TODO: implement FTS5 detection
  return false;
}
