import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleRecall } from '../../src/tools/recall.js';
import type { DatabaseAdapter, EventKind, MemoryRecallResult } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: {
    eventId: string;
    projectRoot: string;
    timestamp: number;
    payloadJson: string;
    sessionId?: string;
    kind?: EventKind;
  },
): void {
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      'codex',
      null,
      normalizeProjectRootForScope(opts.projectRoot),
      opts.sessionId ?? 'sess-1',
      opts.timestamp,
      opts.kind ?? 'session_end',
      opts.payloadJson,
      'high',
      null,
      opts.timestamp,
    ],
  );
}

function insertDurableMemory(
  db: DatabaseAdapter,
  opts: { projectRoot: string; summary: string; topicKey: string; updatedAt: number },
): number {
  return db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json, project_root,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.topicKey,
      'next_step',
      'active',
      opts.summary,
      JSON.stringify({ test: true }),
      normalizeProjectRootForScope(opts.projectRoot),
      null,
      'codex',
      null,
      opts.updatedAt,
      opts.updatedAt,
    ],
  ).lastInsertRowid;
}

describe('Track D memory reliability', () => {
  let dir: string;
  let db: NodeSqliteAdapter;
  const now = Date.parse('2026-05-30T12:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-track-d-'));
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not return unrelated project memories for current-project recall', () => {
    const may12 = Date.parse('2026-05-12T10:00:00.000Z');
    insertConversationEvent(db, {
      eventId: 'locus-1',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-locus',
      timestamp: may12,
      payloadJson: '{"summary":"Locus v3.6.1 CODEX_HOME hotfix."}',
    });
    insertConversationEvent(db, {
      eventId: 'vpn-1',
      projectRoot: 'c:/repo/proxyvpn',
      sessionId: 'sess-vpn',
      timestamp: may12,
      payloadJson: '{"summary":"ProxyVpn v3 route update."}',
    });

    const result = handleRecall(
      'вспомни работу в этом месяце по v3',
      { db, now, projectRoot: 'C:/repo/locus' },
      { timeRange: { relative: 'this_month' }, limit: 10, now, temporalMode: 'utc' },
    ) as MemoryRecallResult;

    const text = JSON.stringify(result).toLowerCase();
    expect(text).toContain('locus');
    expect(text).not.toContain('proxyvpn');
  });

  it('keeps same-topic durable memories isolated by project root', () => {
    const topicKey = 'track_d_memory_reliability';
    const locusId = insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      topicKey,
      summary: 'Locus next step: implement Track D project-scoped recall.',
      updatedAt: now - 60_000,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/proxyvpn',
      topicKey,
      summary: 'ProxyVpn next step: implement Track D routing recall.',
      updatedAt: now - 30_000,
    });

    const result = handleRecall(
      'what remains to do for track d memory reliability?',
      { db, now, projectRoot: 'C:/repo/locus' },
      { limit: 10, now },
    ) as MemoryRecallResult;

    expect(result.candidates).toEqual([
      expect.objectContaining({
        durableMemoryIds: [locusId],
        projectRoot: 'c:/repo/locus',
      }),
    ]);
    expect(JSON.stringify(result).toLowerCase()).not.toContain('proxyvpn');
  });

  it('returns searched date buckets for date-scoped recall', () => {
    insertConversationEvent(db, {
      eventId: 'locus-may-12',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-12',
      timestamp: Date.parse('2026-05-12T10:00:00.000Z'),
      payloadJson: '{"summary":"Track D project scope checkpoint."}',
    });
    insertConversationEvent(db, {
      eventId: 'locus-may-20',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-20',
      timestamp: Date.parse('2026-05-20T10:00:00.000Z'),
      payloadJson: '{"summary":"Track D ranking checkpoint."}',
    });

    const result = handleRecall(
      'what did we do for Track D?',
      { db, now, projectRoot: 'C:/repo/locus' },
      { timeRange: { relative: 'this_month' }, limit: 10, now, temporalMode: 'utc' },
    ) as MemoryRecallResult;

    expect(result.searchedDateBuckets?.map((bucket) => bucket.key)).toEqual([
      '2026-05-12',
      '2026-05-20',
    ]);
  });
});
