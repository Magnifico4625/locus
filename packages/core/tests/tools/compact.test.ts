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

  it('compacts old tool_use rows after syncing daily_summaries while keeping prompts, durable memories, and recent sessions', () => {
    const now = Date.now();
    const oldTime = now - 45 * 24 * 60 * 60 * 1000;
    const ftsAdapter = createAdapter(tempDir);
    try {
      runMigrations(ftsAdapter, true);
      const projectRoot = 'c:/repo/compact-demo';

      ftsAdapter.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-old-tool',
          'codex',
          null,
          projectRoot,
          'sess-old',
          oldTime,
          'tool_use',
          JSON.stringify({ tool: 'apply_patch', files: ['src/app.ts'], status: 'success' }),
          'high',
          '[]',
          oldTime,
        ],
      );
      const oldToolRowId = ftsAdapter.get<{ id: number }>(
        'SELECT id FROM conversation_events WHERE event_id = ?',
        ['evt-old-tool'],
      )?.id;
      ftsAdapter.run('INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)', [
        oldToolRowId,
        'tool_use apply_patch src/app.ts',
      ]);
      ftsAdapter.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [
        'evt-old-tool',
        'src/app.ts',
      ]);

      ftsAdapter.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-old-prompt',
          'codex',
          null,
          projectRoot,
          'sess-old',
          oldTime + 1000,
          'user_prompt',
          JSON.stringify({ prompt: 'Keep durable narrative prompt forever.' }),
          'high',
          '[]',
          oldTime + 1000,
        ],
      );

      ftsAdapter.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-recent-tool',
          'codex',
          null,
          projectRoot,
          'sess-recent',
          now - 1000,
          'tool_use',
          JSON.stringify({ tool: 'exec', status: 'success' }),
          'medium',
          '[]',
          now - 1000,
        ],
      );

      const res = handleCompact(ftsAdapter, {
        maxAgeDays: 30,
        keepSessions: 1,
        projectRoot,
        journalDir: join(tempDir, 'journal'),
      });

      expect(res.deletedToolEvents).toBe(1);
      expect(res.remainingConversationEvents).toBe(2);
      expect(res.dailySummariesUpserted).toBe(1);
      expect(typeof res.walCheckpointed).toBe('boolean');

      const remainingIds = ftsAdapter
        .all<{ event_id: string }>(
          'SELECT event_id FROM conversation_events ORDER BY timestamp ASC',
        )
        .map((r) => r.event_id);
      expect(remainingIds).toEqual(['evt-old-prompt', 'evt-recent-tool']);

      const orphanedFiles = ftsAdapter.get<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM event_files WHERE event_id = ?',
        ['evt-old-tool'],
      );
      expect(orphanedFiles?.cnt).toBe(0);

      const ftsMatches = ftsAdapter.all<{ rowid: number }>(
        "SELECT rowid FROM conversation_fts WHERE conversation_fts MATCH 'apply_patch'",
      );
      expect(ftsMatches).toEqual([]);

      const dailyCount = ftsAdapter.get<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM daily_summaries WHERE project_root = ?',
        [projectRoot],
      );
      expect(dailyCount?.cnt).toBe(1);

      const skippedToolCompact = handleCompact(ftsAdapter, {
        maxAgeDays: 0,
        keepSessions: 0,
        projectRoot,
        compactToolEvents: false,
      });
      expect(skippedToolCompact.deletedToolEvents).toBe(0);
    } finally {
      ftsAdapter.close();
    }
  });
});
