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

  it('extracts durable memories across codex, antigravity, opencode, dsh, and claude-code idempotently', () => {
    const ts = Date.parse('2026-06-15T10:00:00.000Z');
    const sources = [
      {
        eventId: 'evt-codex',
        source: 'codex',
        summary: 'Decision: use SQLite for local memory persistence.',
      },
      {
        eventId: 'evt-agy',
        source: 'antigravity',
        summary: 'Decision: prefer pre-invocation context injection without MCP calls.',
      },
      {
        eventId: 'evt-oc',
        source: 'opencode',
        summary: 'Next step: wire OpenCode messages.transform plugin hook.',
      },
      {
        eventId: 'evt-dsh',
        source: 'dsh',
        summary: 'Constraint: must not break Cordis dynamic prompt assembly.',
      },
      {
        eventId: 'evt-claude',
        source: 'claude-code',
        summary: 'Preference: prefer one task at a time with explicit verification.',
      },
    ] as const;

    sources.forEach((item, index) => {
      db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.eventId,
          item.source,
          null,
          'c:/repo/multi',
          `sess-${item.source}`,
          ts + index * 1000,
          'session_end',
          JSON.stringify({ summary: item.summary }),
          'high',
          null,
          ts + index * 1000,
        ],
      );
    });

    const first = runDurableExtraction(db);
    expect(first.scanned).toBe(5);
    expect(first.inserted).toBe(5);

    const storedSources = db
      .all<{ source: string; state: string }>(
        'SELECT source, state FROM durable_memories ORDER BY id ASC',
      )
      .map((row) => `${row.source}:${row.state}`);
    expect(storedSources).toEqual([
      'antigravity:active',
      'claude-code:active',
      'codex:active',
      'dsh:active',
      'opencode:active',
    ]);

    for (const item of sources) {
      const wm = db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
        `durable.${item.source}.last_event_id`,
      ]);
      expect(Number(wm?.value ?? '0')).toBeGreaterThan(0);
    }

    const second = runDurableExtraction(db);
    expect(second.scanned).toBe(0);
    expect(second.inserted).toBe(0);
  });
});
