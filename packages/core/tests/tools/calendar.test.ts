import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleCalendar } from '../../src/tools/calendar.js';
import type { DatabaseAdapter, EventKind } from '../../src/types.js';

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
      opts.projectRoot,
      opts.sessionId ?? 'sess-1',
      opts.timestamp,
      opts.kind ?? 'session_end',
      JSON.stringify({ summary: opts.eventId }),
      'high',
      null,
      opts.timestamp,
    ],
  );
}

function insertDurableMemory(
  db: DatabaseAdapter,
  opts: { projectRoot: string; topicKey?: string; updatedAt: number; summary?: string },
): void {
  db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json, project_root,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.topicKey ?? null,
      'decision',
      'active',
      opts.summary ?? 'Calendar durable memory',
      JSON.stringify({ test: true }),
      opts.projectRoot,
      null,
      'codex',
      null,
      opts.updatedAt,
      opts.updatedAt,
    ],
  );
}

describe('handleCalendar', () => {
  let dir: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-calendar-'));
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns day buckets only for the requested project', () => {
    const may12 = new Date(2026, 4, 12, 10).getTime();
    const may24 = new Date(2026, 4, 24, 10).getTime();
    insertConversationEvent(db, {
      eventId: 'locus-1',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-locus',
      timestamp: may12,
    });
    insertConversationEvent(db, {
      eventId: 'locus-2',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-locus',
      timestamp: may12 + 60_000,
    });
    insertConversationEvent(db, {
      eventId: 'vpn-1',
      projectRoot: 'c:/repo/proxyvpn',
      sessionId: 'sess-vpn',
      timestamp: may24,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      topicKey: 'track_d',
      updatedAt: may12 + 120_000,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      topicKey: 'calendar',
      updatedAt: may12 + 180_000,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      topicKey: 'track_d',
      updatedAt: may12 + 240_000,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/proxyvpn',
      topicKey: 'vpn',
      updatedAt: may24,
    });

    const result = handleCalendar(
      { db, projectRoot: 'C:/repo/locus', now: new Date(2026, 4, 30, 12).getTime() },
      { timeRange: { relative: 'this_month' }, granularity: 'day' },
    );

    expect(result.projectRoot).toBe('c:/repo/locus');
    expect(result.granularity).toBe('day');
    expect(result.resolvedRange).toMatchObject({ label: 'this_month' });
    expect(result.buckets).toEqual([
      expect.objectContaining({
        key: '2026-05-12',
        eventCount: 2,
        sessionCount: 1,
        durableCount: 3,
        topicKeys: ['calendar', 'track_d'],
      }),
    ]);
  });

  it('returns week buckets sorted ascending and respects limit', () => {
    const now = new Date(2026, 4, 30, 12).getTime();
    for (const [eventId, day] of [
      ['week-1', 4],
      ['week-2', 11],
      ['week-3', 18],
    ] as const) {
      insertConversationEvent(db, {
        eventId,
        projectRoot: 'c:/repo/locus',
        timestamp: new Date(2026, 4, day, 10).getTime(),
      });
    }

    const result = handleCalendar(
      { db, projectRoot: 'c:/repo/locus', now },
      { timeRange: { relative: 'this_month' }, granularity: 'week', limit: 2 },
    );

    expect(result.granularity).toBe('week');
    expect(result.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-05-04/week',
      '2026-05-11/week',
    ]);
  });
});
