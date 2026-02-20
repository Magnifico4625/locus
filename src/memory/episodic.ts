import type { DatabaseAdapter, MemoryEntry } from '../types.js';
import { estimateTokens } from '../utils.js';

interface MemoryRow {
  id: number;
  layer: string;
  content: string;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
  session_id: string | null;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    layer: row.layer as 'semantic' | 'episodic',
    content: row.content,
    tags: row.tags_json ? (JSON.parse(row.tags_json) as string[]) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionId: row.session_id ?? undefined,
  };
}

export class EpisodicMemory {
  private readonly db: DatabaseAdapter;

  constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  addEvent(content: string, sessionId: string): MemoryEntry {
    const now = Date.now();
    const result = this.db.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES (?, ?, ?, ?, ?, ?)',
      ['episodic', content, '[]', now, now, sessionId],
    );
    const row = this.db.get<MemoryRow>(
      'SELECT id, layer, content, tags_json, created_at, updated_at, session_id FROM memories WHERE id = ?',
      [result.lastInsertRowid],
    );
    return rowToEntry(row as MemoryRow);
  }

  getRecent(limit = 50): MemoryEntry[] {
    const rows = this.db.all<MemoryRow>(
      'SELECT id, layer, content, tags_json, created_at, updated_at, session_id FROM memories WHERE layer = ? ORDER BY created_at DESC LIMIT ?',
      ['episodic', limit],
    );
    return rows.map(rowToEntry);
  }

  getBufferTokens(): number {
    const rows = this.db.all<{ content: string }>('SELECT content FROM memories WHERE layer = ?', [
      'episodic',
    ]);
    let total = 0;
    for (const row of rows) {
      total += estimateTokens(row.content);
    }
    return total;
  }

  count(): number {
    const row = this.db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM memories WHERE layer = ?',
      ['episodic'],
    );
    return row?.cnt ?? 0;
  }

  sessionCount(): number {
    const row = this.db.get<{ cnt: number }>(
      'SELECT COUNT(DISTINCT session_id) as cnt FROM memories WHERE layer = ?',
      ['episodic'],
    );
    return row?.cnt ?? 0;
  }

  getSessionEntries(sessionId: string): MemoryEntry[] {
    const rows = this.db.all<MemoryRow>(
      'SELECT id, layer, content, tags_json, created_at, updated_at, session_id FROM memories WHERE layer = ? AND session_id = ? ORDER BY created_at ASC',
      ['episodic', sessionId],
    );
    return rows.map(rowToEntry);
  }
}
