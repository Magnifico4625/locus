import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

function writeEventFile(inboxDir: string, event: InboxEvent): string {
  const shortId = event.event_id.slice(0, 8);
  const filename = `${event.timestamp}-${shortId}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(event), 'utf-8');
  return filename;
}

describe('processInbox', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-pipeline-'));
    inboxDir = join(tempDir, 'inbox');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(inboxDir, { recursive: true });
    adapter = createAdapter(tempDir);
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns zero metrics for empty inbox', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.processed).toBe(0);
    expect(metrics.skipped).toBe(0);
    expect(metrics.duplicates).toBe(0);
    expect(metrics.errors).toBe(0);
    expect(metrics.remaining).toBe(0);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zero metrics when inbox dir does not exist', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const metrics = processInbox(join(tempDir, 'nonexistent'), adapter);
    expect(metrics.processed).toBe(0);
    expect(metrics.remaining).toBe(0);
  });

  it('processes valid event and records in ingest_log', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();
    writeEventFile(inboxDir, event);

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.processed).toBe(1);

    const row = adapter.get<{ event_id: string }>(
      'SELECT event_id FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(row).toBeDefined();
    expect(row?.event_id).toBe(event.event_id);
  });

  it('deletes processed event file from inbox', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter);

    const remaining = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
  });

  it('increments errors for invalid JSON file', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    writeFileSync(join(inboxDir, '1000000000000-deadbeef.json'), '{bad json', 'utf-8');

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.errors).toBe(1);
    expect(metrics.processed).toBe(0);
  });

  it('does not delete invalid JSON file', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const filename = '1000000000000-deadbeef.json';
    writeFileSync(join(inboxDir, filename), '{bad json', 'utf-8');

    processInbox(inboxDir, adapter);

    const remaining = readdirSync(inboxDir);
    expect(remaining).toContain(filename);
  });

  it('increments skipped for schema-invalid event', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const invalid = { version: 2, kind: 'bogus', timestamp: 100 };
    writeFileSync(join(inboxDir, '1000000000000-badbad00.json'), JSON.stringify(invalid), 'utf-8');

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.skipped).toBe(1);
    expect(metrics.processed).toBe(0);
  });

  it('does not delete schema-invalid event file', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const filename = '1000000000000-badbad00.json';
    const invalid = { version: 2, kind: 'bogus' };
    writeFileSync(join(inboxDir, filename), JSON.stringify(invalid), 'utf-8');

    processInbox(inboxDir, adapter);

    const remaining = readdirSync(inboxDir);
    expect(remaining).toContain(filename);
  });

  it('increments duplicates and deletes duplicate event file', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();

    // First run: process the event
    writeEventFile(inboxDir, event);
    processInbox(inboxDir, adapter);

    // Second run: same event_id → duplicate
    writeEventFile(inboxDir, event);
    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.duplicates).toBe(1);
    expect(metrics.processed).toBe(0);

    const remaining = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
  });

  it('respects batch limit', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    const event1 = makeEvent({
      event_id: 'aaaaaaaa-0001-0001-0001-000000000001',
      timestamp: 1000000000001,
    });
    const event2 = makeEvent({
      event_id: 'bbbbbbbb-0002-0002-0002-000000000002',
      timestamp: 1000000000002,
    });
    const event3 = makeEvent({
      event_id: 'cccccccc-0003-0003-0003-000000000003',
      timestamp: 1000000000003,
    });

    writeEventFile(inboxDir, event1);
    writeEventFile(inboxDir, event2);
    writeEventFile(inboxDir, event3);

    const metrics = processInbox(inboxDir, adapter, { batchLimit: 2 });
    expect(metrics.processed).toBe(2);
    expect(metrics.remaining).toBe(1);
  });

  it('processes files in timestamp order (sorted by filename)', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    // Write events with out-of-order timestamps to verify sort
    const eventLate = makeEvent({
      event_id: 'late0000-0000-0000-0000-000000000000',
      timestamp: 9000000000000,
    });
    const eventEarly = makeEvent({
      event_id: 'early000-0000-0000-0000-000000000000',
      timestamp: 1000000000000,
    });

    // Write late first, early second (FS order)
    writeEventFile(inboxDir, eventLate);
    writeEventFile(inboxDir, eventEarly);

    // Batch limit 1 → should pick the earliest by filename sort
    const metrics = processInbox(inboxDir, adapter, { batchLimit: 1 });
    expect(metrics.processed).toBe(1);

    // The early event should have been processed (sorted first)
    const row = adapter.get<{ event_id: string }>(
      'SELECT event_id FROM ingest_log WHERE event_id = ?',
      [eventEarly.event_id],
    );
    expect(row).toBeDefined();
  });

  it('handles batchLimit=0 as unlimited', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    for (let i = 1; i <= 5; i++) {
      writeEventFile(
        inboxDir,
        makeEvent({
          event_id: `id-${String(i).padStart(8, '0')}-0000-0000-000000000000`,
          timestamp: 1000000000000 + i,
        }),
      );
    }

    const metrics = processInbox(inboxDir, adapter, { batchLimit: 0 });
    expect(metrics.processed).toBe(5);
    expect(metrics.remaining).toBe(0);
  });

  it('ignores non-JSON files in inbox', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    writeFileSync(join(inboxDir, 'readme.txt'), 'not json', 'utf-8');
    writeFileSync(join(inboxDir, 'data.tmp'), 'temp file', 'utf-8');

    const event = makeEvent();
    writeEventFile(inboxDir, event);

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.processed).toBe(1);
    expect(metrics.errors).toBe(0);
    expect(metrics.skipped).toBe(0);
  });

  it('processes multiple valid events correctly', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    const event1 = makeEvent({
      event_id: 'evt-00000001-0000-0000-0000-000000000000',
      timestamp: 1000000000001,
      kind: 'user_prompt',
    });
    const event2 = makeEvent({
      event_id: 'evt-00000002-0000-0000-0000-000000000000',
      timestamp: 1000000000002,
      kind: 'tool_use',
    });

    writeEventFile(inboxDir, event1);
    writeEventFile(inboxDir, event2);

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.processed).toBe(2);
    expect(metrics.errors).toBe(0);
    expect(metrics.skipped).toBe(0);
    expect(metrics.duplicates).toBe(0);
    expect(metrics.remaining).toBe(0);

    const rows = adapter.all<{ event_id: string }>(
      'SELECT event_id FROM ingest_log ORDER BY event_id',
    );
    expect(rows).toHaveLength(2);
  });
});
