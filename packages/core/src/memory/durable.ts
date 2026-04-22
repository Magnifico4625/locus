import type {
  DatabaseAdapter,
  DurableMemoryEntry,
  DurableMemoryState,
  DurableMemoryType,
} from '../types.js';
import { sanitizeFtsQuery } from '../utils.js';

interface DurableMemoryRow {
  id: number;
  topic_key: string | null;
  memory_type: DurableMemoryType;
  state: DurableMemoryState;
  summary: string;
  evidence_json: string;
  source_event_id: string | null;
  source: 'codex' | 'claude-code' | 'manual';
  superseded_by_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateDurableMemoryInput {
  topicKey?: string;
  memoryType: DurableMemoryType;
  state?: DurableMemoryState;
  summary: string;
  evidence: Record<string, unknown>;
  sourceEventId?: string;
  source: 'codex' | 'claude-code' | 'manual';
  supersededById?: number;
}

function rowToEntry(row: DurableMemoryRow): DurableMemoryEntry {
  return {
    id: row.id,
    topicKey: row.topic_key ?? undefined,
    memoryType: row.memory_type,
    state: row.state,
    summary: row.summary,
    evidence: JSON.parse(row.evidence_json) as Record<string, unknown>,
    sourceEventId: row.source_event_id ?? undefined,
    source: row.source,
    supersededById: row.superseded_by_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DurableMemoryStore {
  private readonly db: DatabaseAdapter;
  private readonly fts5: boolean;

  constructor(db: DatabaseAdapter, fts5Available: boolean) {
    this.db = db;
    this.fts5 = fts5Available;
  }

  insert(input: CreateDurableMemoryInput): DurableMemoryEntry {
    const now = Date.now();
    const result = this.db.run(
      `INSERT INTO durable_memories (
        topic_key,
        memory_type,
        state,
        summary,
        evidence_json,
        source_event_id,
        source,
        superseded_by_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.topicKey ?? null,
        input.memoryType,
        input.state ?? 'active',
        input.summary,
        JSON.stringify(input.evidence),
        input.sourceEventId ?? null,
        input.source,
        input.supersededById ?? null,
        now,
        now,
      ],
    );

    const row = this.db.get<DurableMemoryRow>('SELECT * FROM durable_memories WHERE id = ?', [
      result.lastInsertRowid,
    ]);
    if (!row) {
      throw new Error('Failed to read inserted durable memory row');
    }

    if (this.fts5) {
      this.db.run('INSERT INTO durable_memories_fts(rowid, summary) VALUES (?, ?)', [
        row.id,
        row.summary,
      ]);
    }

    return rowToEntry(row);
  }

  updateState(id: number, state: DurableMemoryState, supersededById?: number): boolean {
    const existing = this.db.get<DurableMemoryRow>('SELECT * FROM durable_memories WHERE id = ?', [id]);
    if (!existing) {
      return false;
    }

    const result = this.db.run(
      'UPDATE durable_memories SET state = ?, superseded_by_id = ?, updated_at = ? WHERE id = ?',
      [state, supersededById ?? null, Date.now(), id],
    );
    return result.changes > 0;
  }

  removeById(id: number): boolean {
    const existing = this.db.get<DurableMemoryRow>('SELECT * FROM durable_memories WHERE id = ?', [id]);
    if (!existing) {
      return false;
    }

    if (this.fts5) {
      this.db.run(
        "INSERT INTO durable_memories_fts(durable_memories_fts, rowid, summary) VALUES ('delete', ?, ?)",
        [id, existing.summary],
      );
    }

    const result = this.db.run('DELETE FROM durable_memories WHERE id = ?', [id]);
    return result.changes > 0;
  }

  listByTopic(topicKey: string): DurableMemoryEntry[] {
    const rows = this.db.all<DurableMemoryRow>(
      'SELECT * FROM durable_memories WHERE topic_key = ? ORDER BY updated_at DESC, id DESC',
      [topicKey],
    );
    return rows.map(rowToEntry);
  }

  search(query: string, limit = 20): DurableMemoryEntry[] {
    if (this.fts5) {
      const sanitized = sanitizeFtsQuery(query);
      if (!sanitized) {
        return [];
      }

      const rows = this.db.all<DurableMemoryRow>(
        `SELECT * FROM durable_memories
         WHERE id IN (SELECT rowid FROM durable_memories_fts WHERE durable_memories_fts MATCH ?)
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        [sanitized, limit],
      );
      return rows.map(rowToEntry);
    }

    const rows = this.db.all<DurableMemoryRow>(
      'SELECT * FROM durable_memories WHERE summary LIKE ? ORDER BY updated_at DESC, id DESC LIMIT ?',
      [`%${query}%`, limit],
    );
    return rows.map(rowToEntry);
  }
}
