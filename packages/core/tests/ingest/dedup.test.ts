import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { InboxEvent } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function makeEvent(overrides?: Partial<InboxEvent>): InboxEvent {
  return {
    version: 1,
    event_id: 'a1b2c3d4-5678-9abc-def0-1234567890ab',
    source: 'claude-code',
    project_root: '/home/user/myapp',
    timestamp: 1708876543210,
    kind: 'tool_use',
    payload: { tool: 'Bash', files: [], status: 'success' },
    ...overrides,
  };
}

describe('isDuplicate', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-dedup-'));
    adapter = createAdapter(tempDir);
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false for unknown event_id', async () => {
    const { isDuplicate } = await import('../../src/ingest/dedup.js');
    expect(isDuplicate(adapter, 'never-seen-before')).toBe(false);
  });

  it('returns true after event is recorded', async () => {
    const { isDuplicate, recordProcessed } = await import('../../src/ingest/dedup.js');
    const event = makeEvent();
    recordProcessed(adapter, event);
    expect(isDuplicate(adapter, event.event_id)).toBe(true);
  });

  it('returns false for different event_id', async () => {
    const { isDuplicate, recordProcessed } = await import('../../src/ingest/dedup.js');
    recordProcessed(adapter, makeEvent({ event_id: 'first-event-id' }));
    expect(isDuplicate(adapter, 'different-event-id')).toBe(false);
  });
});

describe('recordProcessed', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-dedup-'));
    adapter = createAdapter(tempDir);
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes row to ingest_log', async () => {
    const { recordProcessed } = await import('../../src/ingest/dedup.js');
    const event = makeEvent();
    recordProcessed(adapter, event);

    const row = adapter.get<{ event_id: string; source: string }>(
      'SELECT event_id, source FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(row).toBeDefined();
    expect(row?.event_id).toBe(event.event_id);
    expect(row?.source).toBe('claude-code');
  });

  it('stores source_event_id when provided', async () => {
    const { recordProcessed } = await import('../../src/ingest/dedup.js');
    const event = makeEvent({ source_event_id: 'src-42' });
    recordProcessed(adapter, event);

    const row = adapter.get<{ source_event_id: string | null }>(
      'SELECT source_event_id FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.source_event_id).toBe('src-42');
  });

  it('stores null source_event_id when not provided', async () => {
    const { recordProcessed } = await import('../../src/ingest/dedup.js');
    const event = makeEvent();
    recordProcessed(adapter, event);

    const row = adapter.get<{ source_event_id: string | null }>(
      'SELECT source_event_id FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.source_event_id).toBeNull();
  });

  it('is idempotent (INSERT OR IGNORE)', async () => {
    const { recordProcessed } = await import('../../src/ingest/dedup.js');
    const event = makeEvent();
    recordProcessed(adapter, event);
    expect(() => recordProcessed(adapter, event)).not.toThrow();

    const rows = adapter.all<{ event_id: string }>(
      'SELECT event_id FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(rows).toHaveLength(1);
  });

  it('records processed_at timestamp', async () => {
    const { recordProcessed } = await import('../../src/ingest/dedup.js');
    const before = Date.now();
    recordProcessed(adapter, makeEvent());
    const after = Date.now();

    const row = adapter.get<{ processed_at: number }>(
      'SELECT processed_at FROM ingest_log WHERE event_id = ?',
      ['a1b2c3d4-5678-9abc-def0-1234567890ab'],
    );
    expect(row?.processed_at).toBeGreaterThanOrEqual(before);
    expect(row?.processed_at).toBeLessThanOrEqual(after);
  });
});
