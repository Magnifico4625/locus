import type { DatabaseAdapter, MemoryEntry } from '../types.js';

interface MemoryRow {
  id: number;
  layer: string;
  content: string;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
  session_id: string | null;
}

interface CountRow {
  cnt: number;
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

export class SemanticMemory {
  private readonly db: DatabaseAdapter;
  private readonly fts5: boolean;

  constructor(db: DatabaseAdapter, fts5Available: boolean) {
    this.db = db;
    this.fts5 = fts5Available;
  }

  add(content: string, tags: string[]): MemoryEntry {
    const now = Date.now();
    const tagsJson = JSON.stringify(tags);

    const result = this.db.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', content, tagsJson, now, now],
    );

    const id = result.lastInsertRowid;

    if (this.fts5) {
      this.db.run('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)', [id, content]);
    }

    return {
      id,
      layer: 'semantic',
      content,
      tags,
      createdAt: now,
      updatedAt: now,
      sessionId: undefined,
    };
  }

  search(query: string, limit = 20): MemoryEntry[] {
    if (this.fts5) {
      const rows = this.db.all<MemoryRow>(
        "SELECT * FROM memories WHERE layer='semantic' AND id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?) ORDER BY updated_at DESC LIMIT ?",
        [query, limit],
      );
      return rows.map(rowToEntry);
    }

    const rows = this.db.all<MemoryRow>(
      "SELECT * FROM memories WHERE layer='semantic' AND content LIKE ? ORDER BY updated_at DESC LIMIT ?",
      [`%${query}%`, limit],
    );
    return rows.map(rowToEntry);
  }

  remove(id: number): boolean {
    // Read the content first (needed for FTS5 delete sync), also verifies layer
    const existing = this.db.get<MemoryRow>(
      "SELECT * FROM memories WHERE id = ? AND layer='semantic'",
      [id],
    );

    if (existing === undefined) {
      return false;
    }

    if (this.fts5) {
      this.db.run(
        "INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', ?, ?)",
        [id, existing.content],
      );
    }

    const result = this.db.run('DELETE FROM memories WHERE id = ?', [id]);
    return result.changes > 0;
  }

  list(limit = 50): MemoryEntry[] {
    const rows = this.db.all<MemoryRow>(
      "SELECT * FROM memories WHERE layer='semantic' ORDER BY updated_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(rowToEntry);
  }

  count(): number {
    const row = this.db.get<CountRow>(
      "SELECT COUNT(*) as cnt FROM memories WHERE layer='semantic'",
    );
    return row?.cnt ?? 0;
  }
}
