import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDurableExtraction } from '../../src/memory/durable-runner.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

describe('runDurableExtraction', () => {
  let dir: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-durable-runner-'));
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('supersedes resolved next_step memories during extraction', () => {
    const ts = Date.parse('2026-05-30T10:00:00.000Z');
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'evt-next',
        'codex',
        null,
        'c:/repo/locus',
        'sess-1',
        ts,
        'session_end',
        '{"summary":"Next step: implement Track D memory recall project-scoped tests."}',
        'high',
        null,
        ts,
      ],
    );
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'evt-validation',
        'codex',
        null,
        'c:/repo/locus',
        'sess-1',
        ts + 1000,
        'session_end',
        '{"summary":"Validation passed: Track D memory recall project-scoped tests."}',
        'high',
        null,
        ts + 1000,
      ],
    );

    const metrics = runDurableExtraction(db);
    const rows = db.all<{
      memory_type: string;
      state: string;
      superseded_by_id: number | null;
    }>(
      `SELECT memory_type, state, superseded_by_id
       FROM durable_memories
       WHERE topic_key = ?
       ORDER BY id ASC`,
      ['track_d_memory_reliability'],
    );

    expect(metrics.superseded).toBe(1);
    expect(rows).toEqual([
      expect.objectContaining({ memory_type: 'next_step', state: 'superseded' }),
      expect.objectContaining({ memory_type: 'validation_fact', state: 'active' }),
    ]);
    expect(rows[0]?.superseded_by_id).toBeGreaterThan(0);
  });
});
