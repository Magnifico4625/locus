import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleSearch } from '../../src/tools/search.js';
import type { DatabaseAdapter } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: { eventId: string; projectRoot: string; payloadJson: string },
): void {
  const now = Date.parse('2026-05-30T10:00:00.000Z');
  const result = db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      'codex',
      null,
      normalizeProjectRootForScope(opts.projectRoot),
      `sess-${opts.eventId}`,
      now,
      'session_end',
      opts.payloadJson,
      'high',
      null,
      now,
    ],
  );
  db.run('INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)', [
    result.lastInsertRowid,
    opts.payloadJson,
  ]);
}

function insertDurableMemory(
  db: DatabaseAdapter,
  opts: { projectRoot: string; summary: string },
): void {
  const now = Date.parse('2026-05-30T10:00:00.000Z');
  db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json, project_root,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'track_d_memory_reliability',
      'decision',
      'active',
      opts.summary,
      JSON.stringify({ test: true }),
      normalizeProjectRootForScope(opts.projectRoot),
      null,
      'codex',
      null,
      now,
      now,
    ],
  );
}

function insertEpisodicMemory(
  db: DatabaseAdapter,
  opts: { projectRoot: string; content: string },
): void {
  const now = Date.parse('2026-05-30T10:00:00.000Z');
  db.run(
    `INSERT INTO memories
     (layer, content, tags_json, project_root, created_at, updated_at, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'episodic',
      opts.content,
      null,
      normalizeProjectRootForScope(opts.projectRoot),
      now,
      now,
      'sess-episodic',
    ],
  );
}

describe('memory_search project scope', () => {
  let dir: string;
  let db: NodeSqliteAdapter;
  let semantic: SemanticMemory;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-search-scope-'));
    db = createAdapter(dir);
    runMigrations(db, true);
    semantic = new SemanticMemory(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('excludes semantic, episodic, durable, and conversation rows from other projects', () => {
    semantic.add('TRACKD-SCOPE Locus semantic memory', ['track-d'], {
      projectRoot: 'c:/repo/locus',
    });
    semantic.add('TRACKD-SCOPE ProxyVpn semantic memory', ['track-d'], {
      projectRoot: 'c:/repo/proxyvpn',
    });
    insertEpisodicMemory(db, {
      projectRoot: 'c:/repo/locus',
      content: 'TRACKD-SCOPE Locus episodic memory',
    });
    insertEpisodicMemory(db, {
      projectRoot: 'c:/repo/proxyvpn',
      content: 'TRACKD-SCOPE ProxyVpn episodic memory',
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      summary: 'TRACKD-SCOPE Locus durable decision',
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/proxyvpn',
      summary: 'TRACKD-SCOPE ProxyVpn durable decision',
    });
    insertConversationEvent(db, {
      eventId: 'evt-locus',
      projectRoot: 'c:/repo/locus',
      payloadJson: '{"summary":"TRACKD-SCOPE Locus conversation"}',
    });
    insertConversationEvent(db, {
      eventId: 'evt-proxyvpn',
      projectRoot: 'c:/repo/proxyvpn',
      payloadJson: '{"summary":"TRACKD-SCOPE ProxyVpn conversation"}',
    });

    const results = handleSearch(
      'TRACKD-SCOPE',
      { db, semantic, fts5: true },
      { projectRoot: 'C:/repo/locus' },
    );

    const matching = results.filter((result) => result.content.includes('TRACKD-SCOPE'));
    expect(matching).toHaveLength(4);
    expect(matching.map((result) => result.content).join('\n')).toContain('Locus');
    expect(matching.map((result) => result.content).join('\n')).not.toContain('ProxyVpn');
  });
});
