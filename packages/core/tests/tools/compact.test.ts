import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleCompact } from '../../src/tools/compact.js';
import type { DatabaseAdapter } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('handleCompact', () => {
  let tempDir: string;
  let db: DatabaseAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-compact-'));
    const adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    db = adapter;
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns zero deletedEntries when no episodic data exists', () => {
    const result = handleCompact(db, {});
    expect(result.deletedEntries).toBe(0);
    expect(result.remainingEntries).toBe(0);
    expect(result.remainingSessions).toBe(0);
  });

  it('deletes entries older than maxAgeDays', () => {
    const now = Date.now();
    const oldTime = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago

    // Insert old entry
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'old event', '[]', ?, ?, 'session-old')",
      [oldTime, oldTime],
    );
    // Insert recent entry
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'new event', '[]', ?, ?, 'session-new')",
      [now, now],
    );

    const result = handleCompact(db, { maxAgeDays: 30, keepSessions: 0 });
    expect(result.deletedEntries).toBe(1);
    expect(result.remainingEntries).toBe(1);
  });

  it('keeps entries from recent sessions even if old', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago

    // Insert entries in 3 sessions, all old
    for (let i = 0; i < 3; i++) {
      db.run(
        "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', ?, '[]', ?, ?, ?)",
        [`event-${i}`, oldTime + i * 1000, oldTime + i * 1000, `session-${i}`],
      );
    }

    // keepSessions=5 means keep all 3 (only 3 exist)
    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 5 });
    expect(result.deletedEntries).toBe(0);
    expect(result.remainingSessions).toBe(3);
  });

  it('does not delete semantic memories', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000;

    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES ('semantic', 'decision', '[]', ?, ?)",
      [oldTime, oldTime],
    );
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'old event', '[]', ?, ?, 'sess1')",
      [oldTime, oldTime],
    );

    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 0 });
    expect(result.deletedEntries).toBe(1);

    // Verify semantic entry still exists
    const semanticCount = db.get<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM memories WHERE layer = 'semantic'",
    );
    expect(semanticCount?.cnt).toBe(1);
  });

  it('uses default maxAgeDays=30 and keepSessions=5', () => {
    const result = handleCompact(db, {});
    expect(result.deletedEntries).toBe(0);
    // Just verify it doesn't throw with no params
  });

  it('deletes entries with NULL session_id when older than cutoff', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000;

    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'orphan', '[]', ?, ?, NULL)",
      [oldTime, oldTime],
    );

    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 5 });
    expect(result.deletedEntries).toBe(1);
  });

  it('respects keepSessions limit — oldest sessions are pruned first', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000;

    // 3 sessions: session-0 oldest, session-2 newest (by created_at offset)
    for (let i = 0; i < 3; i++) {
      db.run(
        "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', ?, '[]', ?, ?, ?)",
        [`event-${i}`, oldTime + i * 1000, oldTime + i * 1000, `session-${i}`],
      );
    }

    // Keep only 1 session — should keep session-2 (most recent), delete session-0 and session-1
    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 1 });
    expect(result.deletedEntries).toBe(2);
    expect(result.remainingEntries).toBe(1);
    expect(result.remainingSessions).toBe(1);

    // Verify the kept entry is from session-2
    const kept = db.get<{ session_id: string }>(
      "SELECT session_id FROM memories WHERE layer = 'episodic'",
    );
    expect(kept?.session_id).toBe('session-2');
  });

  it('does not delete durable memories or change durable states during compact', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000;

    db.run(
      `INSERT INTO durable_memories (
        topic_key, memory_type, state, summary, evidence_json,
        source_event_id, source, superseded_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'database_choice',
        'decision',
        'stale',
        'Use SQLite locally.',
        '{}',
        null,
        'codex',
        null,
        oldTime,
        oldTime,
      ],
    );
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'old event', '[]', ?, ?, 'sess1')",
      [oldTime, oldTime],
    );

    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 0 });
    const durableRow = db.get<{ cnt: number; stale_count: number }>(
      `SELECT
         COUNT(*) AS cnt,
         SUM(CASE WHEN state = 'stale' THEN 1 ELSE 0 END) AS stale_count
       FROM durable_memories`,
    );

    expect(result.deletedEntries).toBe(1);
    expect(durableRow?.cnt ?? 0).toBe(1);
    expect(durableRow?.stale_count ?? 0).toBe(1);
  });
});
