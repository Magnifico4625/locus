import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { ConversationEventRow, EventFileRow, InboxEvent } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function makeEvent(overrides?: Partial<InboxEvent>): InboxEvent {
  return {
    version: 1,
    event_id: 'store-test-0001-0000-0000-000000000000',
    source: 'claude-code',
    project_root: '/home/user/myapp',
    timestamp: 1708876543210,
    kind: 'tool_use',
    payload: { tool: 'Bash', files: ['src/index.ts'], status: 'success' },
    ...overrides,
  };
}

function writeEventFile(inboxDir: string, event: InboxEvent): string {
  const shortId = event.event_id.slice(0, 8);
  const filename = `${event.timestamp}-${shortId}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(event), 'utf-8');
  return filename;
}

describe('processInbox — store phase', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-pipeline-store-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    adapter = createAdapter(tempDir);
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores event in conversation_events table', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const row = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row).toBeDefined();
    expect(row?.event_id).toBe(event.event_id);
    expect(row?.source).toBe('claude-code');
    expect(row?.kind).toBe('tool_use');
    expect(row?.timestamp).toBe(event.timestamp);
    expect(row?.project_root).toBe('/home/user/myapp');
  });

  it('stores significance in conversation_events', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Write', files: ['src/new.ts'], status: 'success' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const row = adapter.get<ConversationEventRow>(
      'SELECT significance FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.significance).toBe('high');
  });

  it('stores event_files rows for file paths in payload', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      payload: { tool: 'Bash', files: ['src/a.ts', 'src/b.ts'], status: 'success' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const rows = adapter.all<EventFileRow>('SELECT * FROM event_files WHERE event_id = ?', [
      event.event_id,
    ]);
    expect(rows).toHaveLength(2);
    const paths = rows.map((r) => r.file_path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('stores event_files for file_diff path', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      event_id: 'store-diff-0001-0000-0000-000000000000',
      kind: 'file_diff',
      payload: { path: 'src/config.ts', added: 10, removed: 3 },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const rows = adapter.all<EventFileRow>('SELECT * FROM event_files WHERE event_id = ?', [
      event.event_id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.file_path).toBe('src/config.ts');
  });

  it('redacts secrets in stored payload', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      event_id: 'store-secret-001-0000-0000-000000000000',
      kind: 'user_prompt',
      payload: { prompt: 'set API_KEY=sk-abc123456789012345678901234567890 in config' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const row = adapter.get<ConversationEventRow>(
      'SELECT payload_json FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.payload_json).toBeDefined();
    expect(row?.payload_json).not.toContain('sk-abc123456789012345678901234567890');
    expect(row?.payload_json).toContain('[REDACTED]');
  });

  it('deletes processed JSON files from inbox', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const remaining = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
  });

  it('returns correct metrics after store', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event1 = makeEvent({
      event_id: 'metric-test-001-0000-0000-000000000000',
      timestamp: 1000000000001,
    });
    const event2 = makeEvent({
      event_id: 'metric-test-002-0000-0000-000000000000',
      timestamp: 1000000000002,
      kind: 'user_prompt',
      payload: { prompt: 'build a REST API with authentication and database' },
    });
    writeEventFile(inboxDir, event1);
    writeEventFile(inboxDir, event2);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(metrics.processed).toBe(2);
    expect(metrics.errors).toBe(0);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('filters user_prompt at metadata captureLevel', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'user_prompt',
      payload: { prompt: 'hello world' },
    });
    writeEventFile(inboxDir, event);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'metadata' });
    expect(metrics.filtered).toBe(1);
    expect(metrics.processed).toBe(0);

    const row = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row).toBeUndefined();
  });

  it('filters ai_response at metadata captureLevel', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'ai_response',
      payload: { response: 'here is the answer' },
    });
    writeEventFile(inboxDir, event);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'metadata' });
    expect(metrics.filtered).toBe(1);
    expect(metrics.processed).toBe(0);
  });

  it('allows tool_use at metadata captureLevel', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Read', files: ['src/app.ts'], status: 'success' },
    });
    writeEventFile(inboxDir, event);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'metadata' });
    expect(metrics.processed).toBe(1);
    expect(metrics.filtered).toBe(0);
  });

  it('records in ingest_log after store', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent();
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const row = adapter.get<{ event_id: string }>(
      'SELECT event_id FROM ingest_log WHERE event_id = ?',
      [event.event_id],
    );
    expect(row).toBeDefined();
  });

  it('handles multiple events with correct file path extraction', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    const event1 = makeEvent({
      event_id: 'multi-001-0000-0000-0000-000000000000',
      timestamp: 1000000000001,
      kind: 'tool_use',
      payload: { tool: 'Read', files: ['src/a.ts'], status: 'success' },
    });
    const event2 = makeEvent({
      event_id: 'multi-002-0000-0000-0000-000000000000',
      timestamp: 1000000000002,
      kind: 'file_diff',
      payload: { path: 'src/b.ts', added: 5, removed: 0 },
    });

    writeEventFile(inboxDir, event1);
    writeEventFile(inboxDir, event2);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const files1 = adapter.all<EventFileRow>(
      'SELECT file_path FROM event_files WHERE event_id = ?',
      [event1.event_id],
    );
    expect(files1).toHaveLength(1);
    expect(files1[0]?.file_path).toBe('src/a.ts');

    const files2 = adapter.all<EventFileRow>(
      'SELECT file_path FROM event_files WHERE event_id = ?',
      [event2.event_id],
    );
    expect(files2).toHaveLength(1);
    expect(files2[0]?.file_path).toBe('src/b.ts');
  });

  it('stores payload_json as redacted JSON string', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Bash', files: [], status: 'success', exitCode: 0 },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full' });

    const row = adapter.get<ConversationEventRow>(
      'SELECT payload_json FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.payload_json).toBeDefined();
    const parsed = JSON.parse(row?.payload_json ?? '{}');
    expect(parsed.tool).toBe('Bash');
    expect(parsed.status).toBe('success');
  });

  it('defaults to metadata captureLevel when not specified', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');

    // tool_use should pass at metadata (default)
    const toolEvent = makeEvent({
      event_id: 'default-tool-001-0000-0000-000000000000',
      kind: 'tool_use',
    });
    // user_prompt should be filtered at metadata (default)
    const promptEvent = makeEvent({
      event_id: 'default-prompt-01-0000-0000-000000000000',
      kind: 'user_prompt',
      timestamp: 1708876543211,
      payload: { prompt: 'hello' },
    });

    writeEventFile(inboxDir, toolEvent);
    writeEventFile(inboxDir, promptEvent);

    const metrics = processInbox(inboxDir, adapter);
    expect(metrics.processed).toBe(1);
    expect(metrics.filtered).toBe(1);
  });

  it('deletes filtered event files from inbox', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      kind: 'user_prompt',
      payload: { prompt: 'hello' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'metadata' });

    const remaining = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
  });
});

describe('processInbox — FTS5 store', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;
  let fts5Available: boolean;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-pipeline-fts-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    adapter = createAdapter(tempDir);

    // Detect FTS5 availability
    try {
      adapter.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(content)');
      adapter.exec('DROP TABLE IF EXISTS _fts5_test');
      fts5Available = true;
    } catch {
      fts5Available = false;
    }

    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, fts5Available);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('inserts searchable content into conversation_fts when FTS5 available', async () => {
    if (!fts5Available) return; // skip gracefully

    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      event_id: 'fts-test-0001-0000-0000-000000000000',
      kind: 'user_prompt',
      payload: { prompt: 'implement JWT authentication for the login endpoint' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full', fts5Available: true });

    const row = adapter.get<{ content: string }>(
      "SELECT content FROM conversation_fts WHERE conversation_fts MATCH 'JWT'",
    );
    expect(row).toBeDefined();
    expect(row?.content).toContain('JWT');
  });

  it('indexes tool_use with tool name and file paths in FTS', async () => {
    if (!fts5Available) return;

    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      event_id: 'fts-tool-0001-0000-0000-000000000000',
      kind: 'tool_use',
      payload: { tool: 'Bash', files: ['src/auth/login.ts'], status: 'success' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full', fts5Available: true });

    const row = adapter.get<{ content: string }>(
      "SELECT content FROM conversation_fts WHERE conversation_fts MATCH 'Bash'",
    );
    expect(row).toBeDefined();
  });

  it('does not crash when FTS5 unavailable', async () => {
    const { processInbox } = await import('../../src/ingest/pipeline.js');
    const event = makeEvent({
      event_id: 'nofts-test-001-0000-0000-000000000000',
    });
    writeEventFile(inboxDir, event);

    // fts5Available=false should not crash even if conversation_fts doesn't exist
    const metrics = processInbox(inboxDir, adapter, {
      captureLevel: 'full',
      fts5Available: false,
    });
    expect(metrics.processed).toBe(1);
  });
});
