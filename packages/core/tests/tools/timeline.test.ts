import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleTimeline } from '../../src/tools/timeline.js';
import type { DatabaseAdapter, EventKind } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

// ─── Helper: insert a conversation event ───────────────────────────────────

let ceCounter = 0;

function insertEvent(
  db: DatabaseAdapter,
  opts: {
    event_id?: string;
    kind?: EventKind;
    timestamp?: number;
    payload_json?: string;
    significance?: string;
    session_id?: string;
    source?: string;
  },
): void {
  ceCounter++;
  const eventId = opts.event_id ?? `evt-tl-${ceCounter}-${Date.now()}`;
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      opts.source ?? 'test',
      null,
      '/test/project',
      opts.session_id ?? 'test-session',
      opts.timestamp ?? Date.now(),
      opts.kind ?? 'tool_use',
      opts.payload_json ?? '{"tool":"Read","files":["src/test.ts"],"status":"success"}',
      opts.significance ?? 'medium',
      null,
      Date.now(),
    ],
  );
}

function insertEventFile(db: DatabaseAdapter, eventId: string, filePath: string): void {
  db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [eventId, filePath]);
}

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('handleTimeline', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-timeline-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Returns empty array when no events ──────────────────────────────

  it('returns empty array when no events exist', () => {
    const entries = handleTimeline({ db: adapter });
    expect(entries).toEqual([]);
  });

  // ── 2. Returns events in chronological order (newest first) ────────────

  it('returns events in chronological order (newest first)', () => {
    const now = Date.now();
    insertEvent(adapter, { event_id: 'evt-old', timestamp: now - 3000 });
    insertEvent(adapter, { event_id: 'evt-mid', timestamp: now - 2000 });
    insertEvent(adapter, { event_id: 'evt-new', timestamp: now - 1000 });

    const entries = handleTimeline({ db: adapter });

    expect(entries.length).toBe(3);
    expect(entries[0]?.eventId).toBe('evt-new');
    expect(entries[1]?.eventId).toBe('evt-mid');
    expect(entries[2]?.eventId).toBe('evt-old');
  });

  // ── 3. Default limit is 20 ────────────────────────────────────────────

  it('respects default limit of 20', () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      insertEvent(adapter, {
        event_id: `evt-bulk-${i}`,
        timestamp: now - i * 1000,
      });
    }

    const entries = handleTimeline({ db: adapter });

    expect(entries.length).toBe(20);
  });

  // ── 4. Filters by kind ────────────────────────────────────────────────

  it('filters by kind', () => {
    insertEvent(adapter, { event_id: 'evt-tool', kind: 'tool_use' });
    insertEvent(adapter, { event_id: 'evt-prompt', kind: 'user_prompt' });
    insertEvent(adapter, { event_id: 'evt-diff', kind: 'file_diff' });

    const entries = handleTimeline({ db: adapter }, { kind: 'tool_use' });

    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('tool_use');
  });

  // ── 5. Filters by timeRange (relative: today) ─────────────────────────

  it('filters by timeRange relative=today', () => {
    const now = Date.now();
    insertEvent(adapter, { event_id: 'evt-today', timestamp: now });
    insertEvent(adapter, {
      event_id: 'evt-week-ago',
      timestamp: now - 7 * 86400 * 1000,
    });

    const entries = handleTimeline({ db: adapter }, { timeRange: { relative: 'today' } });

    expect(entries.length).toBe(1);
    expect(entries[0]?.eventId).toBe('evt-today');
  });

  // ── 6. Filters by filePath via event_files ─────────────────────────────

  it('filters by filePath via event_files JOIN', () => {
    insertEvent(adapter, { event_id: 'evt-auth' });
    insertEventFile(adapter, 'evt-auth', 'src/auth.ts');

    insertEvent(adapter, { event_id: 'evt-utils' });
    insertEventFile(adapter, 'evt-utils', 'src/utils.ts');

    const entries = handleTimeline({ db: adapter }, { filePath: 'src/auth.ts' });

    expect(entries.length).toBe(1);
    expect(entries[0]?.eventId).toBe('evt-auth');
  });

  // ── 7. Summary mode returns headers only ───────────────────────────────

  it('summary mode returns only headers (no summary or files)', () => {
    insertEvent(adapter, {
      event_id: 'evt-sum',
      payload_json: '{"tool":"Write","files":["src/a.ts"],"status":"success"}',
    });
    insertEventFile(adapter, 'evt-sum', 'src/a.ts');

    const entries = handleTimeline({ db: adapter }, { summary: true });

    expect(entries.length).toBe(1);
    expect(entries[0]?.eventId).toBe('evt-sum');
    expect(entries[0]?.kind).toBeDefined();
    expect(entries[0]?.timestamp).toBeDefined();
    expect(entries[0]?.summary).toBeUndefined();
    expect(entries[0]?.files).toBeUndefined();
  });

  // ── 8. Full mode includes summary and files ────────────────────────────

  it('full mode includes summary and files', () => {
    insertEvent(adapter, {
      event_id: 'evt-full',
      kind: 'tool_use',
      payload_json: '{"tool":"Write","files":["src/a.ts"],"status":"success"}',
    });
    insertEventFile(adapter, 'evt-full', 'src/a.ts');

    const entries = handleTimeline({ db: adapter }, { summary: false });

    expect(entries.length).toBe(1);
    expect(entries[0]?.summary).toContain('Write');
    expect(entries[0]?.files).toEqual(['src/a.ts']);
  });

  // ── 9. Respects custom limit ───────────────────────────────────────────

  it('respects custom limit', () => {
    for (let i = 0; i < 10; i++) {
      insertEvent(adapter, { event_id: `evt-lim-${i}` });
    }

    const entries = handleTimeline({ db: adapter }, { limit: 3 });

    expect(entries.length).toBe(3);
  });

  // ── 10. Respects offset for pagination ─────────────────────────────────

  it('respects offset for pagination', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      insertEvent(adapter, {
        event_id: `evt-page-${i}`,
        timestamp: now - i * 1000,
      });
    }

    const page1 = handleTimeline({ db: adapter }, { limit: 2, offset: 0 });
    const page2 = handleTimeline({ db: adapter }, { limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    // No overlap
    const page1Ids = page1.map((e) => e.eventId);
    const page2Ids = page2.map((e) => e.eventId);
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id);
    }
  });

  // ── 11. Combines multiple filters ──────────────────────────────────────

  it('combines multiple filters', () => {
    const now = Date.now();

    insertEvent(adapter, {
      event_id: 'evt-match',
      kind: 'tool_use',
      timestamp: now,
    });
    insertEventFile(adapter, 'evt-match', 'src/target.ts');

    insertEvent(adapter, {
      event_id: 'evt-wrong-kind',
      kind: 'user_prompt',
      timestamp: now,
    });
    insertEventFile(adapter, 'evt-wrong-kind', 'src/target.ts');

    insertEvent(adapter, {
      event_id: 'evt-wrong-file',
      kind: 'tool_use',
      timestamp: now,
    });
    insertEventFile(adapter, 'evt-wrong-file', 'src/other.ts');

    const entries = handleTimeline(
      { db: adapter },
      { kind: 'tool_use', filePath: 'src/target.ts' },
    );

    expect(entries.length).toBe(1);
    expect(entries[0]?.eventId).toBe('evt-match');
  });

  // ── 12. Default mode is full (not summary) ─────────────────────────────

  it('default mode is full (includes summary)', () => {
    insertEvent(adapter, {
      event_id: 'evt-default',
      kind: 'tool_use',
      payload_json: '{"tool":"Bash","files":[],"status":"success"}',
    });

    const entries = handleTimeline({ db: adapter });

    expect(entries.length).toBe(1);
    expect(entries[0]?.summary).toBeDefined();
    expect(entries[0]?.summary).toContain('Bash');
  });
});
