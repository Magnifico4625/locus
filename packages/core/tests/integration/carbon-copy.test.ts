import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processInbox } from '../../src/ingest/pipeline.js';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { generateRecent } from '../../src/resources/recent.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleSearch } from '../../src/tools/search.js';
import { handleStatus } from '../../src/tools/status.js';
import { handleTimeline } from '../../src/tools/timeline.js';
import type {
  ConversationEventRow,
  EventFileRow,
  InboxEvent,
  MemoryStatus,
  SearchResult,
} from '../../src/types.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function makeEvent(overrides?: Partial<InboxEvent>): InboxEvent {
  return {
    version: 1,
    event_id: `cc-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'claude-code',
    project_root: '/home/user/myproject',
    session_id: 'cc-test-session-1',
    timestamp: Date.now(),
    kind: 'tool_use',
    payload: { tool: 'Read', files: ['src/app.ts'], status: 'success' },
    ...overrides,
  };
}

function writeEventFile(inboxDir: string, event: InboxEvent): string {
  const shortId = event.event_id.slice(0, 8);
  const filename = `${event.timestamp}-${shortId}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(event), 'utf-8');
  return filename;
}

async function setupDb(dir: string): Promise<{ adapter: NodeSqliteAdapter; fts5: boolean }> {
  const adapter = createAdapter(dir);

  // Detect FTS5
  let fts5 = false;
  try {
    adapter.exec('CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(content)');
    adapter.exec('DROP TABLE IF EXISTS _fts5_test');
    fts5 = true;
  } catch {
    fts5 = false;
  }

  const { runMigrations } = await import('../../src/storage/migrations.js');
  runMigrations(adapter, fts5);

  return { adapter, fts5 };
}

// ─── E2E: Full Carbon Copy Flow ──────────────────────────────────────────────

describe('Carbon Copy E2E — full flow', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;
  let fts5: boolean;

  // Events to write
  const baseTimestamp = 1708900000000;
  const toolEvent: InboxEvent = {
    version: 1,
    event_id: 'cc-e2e-tool-001',
    source: 'claude-code',
    project_root: '/home/user/myproject',
    session_id: 'session-alpha',
    timestamp: baseTimestamp,
    kind: 'tool_use',
    payload: {
      tool: 'Write',
      files: ['src/auth/login.ts', 'src/auth/types.ts'],
      status: 'success',
    },
  };

  const promptEvent: InboxEvent = {
    version: 1,
    event_id: 'cc-e2e-prompt-001',
    source: 'claude-code',
    project_root: '/home/user/myproject',
    session_id: 'session-alpha',
    timestamp: baseTimestamp + 1000,
    kind: 'user_prompt',
    payload: { prompt: 'implement JWT authentication for the login endpoint' },
  };

  const diffEvent: InboxEvent = {
    version: 1,
    event_id: 'cc-e2e-diff-001',
    source: 'claude-code',
    project_root: '/home/user/myproject',
    session_id: 'session-alpha',
    timestamp: baseTimestamp + 2000,
    kind: 'file_diff',
    payload: { path: 'src/auth/login.ts', added: 45, removed: 3 },
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-cc-e2e-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });

    const setup = await setupDb(tempDir);
    adapter = setup.adapter;
    fts5 = setup.fts5;
    semantic = new SemanticMemory(adapter, fts5);

    // Write all events to inbox
    writeEventFile(inboxDir, toolEvent);
    writeEventFile(inboxDir, promptEvent);
    writeEventFile(inboxDir, diffEvent);

    // Process inbox (full captureLevel to allow prompts)
    processInbox(inboxDir, adapter, {
      captureLevel: 'full',
      fts5Available: fts5,
    });
  });

  afterAll(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores all events in conversation_events table', () => {
    const row1 = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [toolEvent.event_id],
    );
    expect(row1).toBeDefined();
    expect(row1?.kind).toBe('tool_use');
    expect(row1?.source).toBe('claude-code');

    const row2 = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [promptEvent.event_id],
    );
    expect(row2).toBeDefined();
    expect(row2?.kind).toBe('user_prompt');

    const row3 = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [diffEvent.event_id],
    );
    expect(row3).toBeDefined();
    expect(row3?.kind).toBe('file_diff');
  });

  it('stores file paths in event_files join table', () => {
    const toolFiles = adapter.all<EventFileRow>('SELECT * FROM event_files WHERE event_id = ?', [
      toolEvent.event_id,
    ]);
    expect(toolFiles).toHaveLength(2);
    const paths = toolFiles.map((r) => r.file_path).sort();
    expect(paths).toEqual(['src/auth/login.ts', 'src/auth/types.ts']);

    const diffFiles = adapter.all<EventFileRow>('SELECT * FROM event_files WHERE event_id = ?', [
      diffEvent.event_id,
    ]);
    expect(diffFiles).toHaveLength(1);
    expect(diffFiles[0]?.file_path).toBe('src/auth/login.ts');
  });

  it('deletes all processed inbox files', () => {
    const remaining = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
  });

  it('handleSearch finds conversation events via LIKE fallback', () => {
    const results: SearchResult[] = handleSearch('Write', {
      db: adapter,
      semantic,
      fts5: false, // force LIKE to test without FTS5
    });

    const convResults = results.filter((r) => r.layer === 'conversation');
    expect(convResults.length).toBeGreaterThan(0);
    expect(convResults[0]?.content).toContain('Write');
  });

  it('handleSearch finds conversation events via FTS5', () => {
    if (!fts5) return;

    const results: SearchResult[] = handleSearch('JWT authentication', {
      db: adapter,
      semantic,
      fts5: true,
    });

    const convResults = results.filter((r) => r.layer === 'conversation');
    expect(convResults.length).toBeGreaterThan(0);
  });

  it('handleSearch filters by kind', () => {
    const results: SearchResult[] = handleSearch(
      'login',
      {
        db: adapter,
        semantic,
        fts5: false,
      },
      { kind: 'file_diff' },
    );

    const convResults = results.filter((r) => r.layer === 'conversation');
    // Should find file_diff event (payload has "login.ts")
    expect(convResults.length).toBeGreaterThan(0);
    for (const r of convResults) {
      expect(r.source).toContain('file_diff');
    }
  });

  it('handleSearch filters by filePath', () => {
    const results: SearchResult[] = handleSearch(
      'auth',
      {
        db: adapter,
        semantic,
        fts5: false,
      },
      { filePath: 'src/auth/types.ts' },
    );

    const convResults = results.filter((r) => r.layer === 'conversation');
    // Only tool_use event has src/auth/types.ts
    expect(convResults.length).toBeGreaterThanOrEqual(1);
    for (const r of convResults) {
      expect(r.source).toContain('tool_use');
    }
  });

  it('handleTimeline returns events in chronological order', () => {
    const entries = handleTimeline({ db: adapter });

    expect(entries.length).toBe(3);
    // DESC order (most recent first)
    expect(entries[0]?.kind).toBe('file_diff');
    expect(entries[1]?.kind).toBe('user_prompt');
    expect(entries[2]?.kind).toBe('tool_use');
  });

  it('handleTimeline summary mode returns headers only', () => {
    const entries = handleTimeline({ db: adapter }, { summary: true });

    expect(entries.length).toBe(3);
    for (const entry of entries) {
      expect(entry.summary).toBeUndefined();
      expect(entry.files).toBeUndefined();
      expect(entry.kind).toBeDefined();
      expect(entry.timestamp).toBeDefined();
    }
  });

  it('handleTimeline filters by kind', () => {
    const entries = handleTimeline({ db: adapter }, { kind: 'tool_use' });

    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('tool_use');
    expect(entries[0]?.files).toEqual(['src/auth/login.ts', 'src/auth/types.ts']);
  });

  it('handleTimeline filters by filePath', () => {
    const entries = handleTimeline({ db: adapter }, { filePath: 'src/auth/login.ts' });

    // Both tool_use and file_diff reference src/auth/login.ts
    expect(entries.length).toBe(2);
    const kinds = entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['file_diff', 'tool_use']);
  });

  it('handleStatus reports conversation event counts', () => {
    const status: MemoryStatus = handleStatus({
      projectPath: tempDir,
      projectRoot: '/home/user/myproject',
      projectRootMethod: 'cwd-fallback',
      dbPath: join(tempDir, 'test.db'),
      db: adapter,
      config: LOCUS_DEFAULTS,
      backend: 'node:sqlite',
      fts5,
      inboxDir,
    });

    expect(status.totalConversationEvents).toBe(3);
    expect(status.inboxPending).toBe(0);
  });

  it('generateRecent includes conversation activity section', () => {
    const text = generateRecent(adapter, 'full');

    expect(text).toContain('Conversation Activity');
    expect(text).toContain('3 total');
    // At full captureLevel, prompts are shown
    expect(text).toContain('JWT authentication');
  });

  it('generateRecent at metadata hides prompts', () => {
    const text = generateRecent(adapter, 'metadata');

    expect(text).toContain('Conversation Activity');
    // At metadata, prompts should NOT be shown
    expect(text).not.toContain('JWT authentication');
  });
});

// ─── E2E: CaptureLevel Gates ─────────────────────────────────────────────────

describe('Carbon Copy E2E — captureLevel gates', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-cc-capture-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });

    const setup = await setupDb(tempDir);
    adapter = setup.adapter;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('metadata captureLevel filters user_prompt but allows tool_use', () => {
    const prompt = makeEvent({
      event_id: 'cap-prompt-001',
      kind: 'user_prompt',
      payload: { prompt: 'build a REST API' },
    });
    const tool = makeEvent({
      event_id: 'cap-tool-001',
      kind: 'tool_use',
      payload: { tool: 'Bash', files: [], status: 'success' },
    });

    writeEventFile(inboxDir, prompt);
    writeEventFile(inboxDir, tool);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'metadata' });
    expect(metrics.processed).toBe(1);
    expect(metrics.filtered).toBe(1);

    // tool_use stored
    const toolRow = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [tool.event_id],
    );
    expect(toolRow).toBeDefined();

    // user_prompt NOT stored
    const promptRow = adapter.get<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [prompt.event_id],
    );
    expect(promptRow).toBeUndefined();
  });

  it('metadata captureLevel filters ai_response', () => {
    const response = makeEvent({
      event_id: 'cap-ai-001',
      kind: 'ai_response',
      payload: { response: 'Here is the implementation...' },
    });

    writeEventFile(inboxDir, response);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'metadata' });
    expect(metrics.filtered).toBe(1);
    expect(metrics.processed).toBe(0);
  });

  it('full captureLevel allows all event kinds', () => {
    const prompt = makeEvent({
      event_id: 'full-prompt-001',
      kind: 'user_prompt',
      timestamp: 1000000001,
      payload: { prompt: 'add unit tests' },
    });
    const response = makeEvent({
      event_id: 'full-ai-001',
      kind: 'ai_response',
      timestamp: 1000000002,
      payload: { response: 'Sure, here are the tests...' },
    });
    const tool = makeEvent({
      event_id: 'full-tool-001',
      kind: 'tool_use',
      timestamp: 1000000003,
      payload: { tool: 'Write', files: ['tests/app.test.ts'], status: 'success' },
    });

    writeEventFile(inboxDir, prompt);
    writeEventFile(inboxDir, response);
    writeEventFile(inboxDir, tool);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(metrics.processed).toBe(3);
    expect(metrics.filtered).toBe(0);
  });
});

// ─── E2E: Dedup ──────────────────────────────────────────────────────────────

describe('Carbon Copy E2E — dedup', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-cc-dedup-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });

    const setup = await setupDb(tempDir);
    adapter = setup.adapter;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('duplicate event_id is not stored twice', () => {
    const event1 = makeEvent({
      event_id: 'dup-test-001',
      kind: 'tool_use',
      timestamp: 1000000001,
      payload: { tool: 'Read', files: ['src/a.ts'], status: 'success' },
    });

    // First processing
    writeEventFile(inboxDir, event1);
    const metrics1 = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(metrics1.processed).toBe(1);

    // Write same event_id again
    writeEventFile(inboxDir, { ...event1, timestamp: 1000000002 });
    const metrics2 = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(metrics2.duplicates).toBe(1);
    expect(metrics2.processed).toBe(0);

    // Only 1 row in DB
    const rows = adapter.all<ConversationEventRow>(
      'SELECT * FROM conversation_events WHERE event_id = ?',
      [event1.event_id],
    );
    expect(rows).toHaveLength(1);
  });

  it('different event_ids with same content are stored separately', () => {
    const event1 = makeEvent({
      event_id: 'unique-001',
      kind: 'tool_use',
      timestamp: 1000000001,
      payload: { tool: 'Read', files: ['src/a.ts'], status: 'success' },
    });
    const event2 = makeEvent({
      event_id: 'unique-002',
      kind: 'tool_use',
      timestamp: 1000000002,
      payload: { tool: 'Read', files: ['src/a.ts'], status: 'success' },
    });

    writeEventFile(inboxDir, event1);
    writeEventFile(inboxDir, event2);

    const metrics = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(metrics.processed).toBe(2);

    const count = adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events');
    expect(count?.cnt).toBe(2);
  });
});

// ─── E2E: Secret Redaction ───────────────────────────────────────────────────

describe('Carbon Copy E2E — secret redaction', () => {
  let tempDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;
  let fts5: boolean;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-cc-redact-'));
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });

    const setup = await setupDb(tempDir);
    adapter = setup.adapter;
    fts5 = setup.fts5;
    semantic = new SemanticMemory(adapter, fts5);
  });

  afterAll(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('redacts API keys in stored payload', () => {
    const event = makeEvent({
      event_id: 'redact-api-001',
      kind: 'user_prompt',
      payload: { prompt: 'set OPENAI_API_KEY=sk-abc123456789012345678901234567890 in .env' },
    });
    writeEventFile(inboxDir, event);

    processInbox(inboxDir, adapter, { captureLevel: 'full', fts5Available: fts5 });

    const row = adapter.get<ConversationEventRow>(
      'SELECT payload_json FROM conversation_events WHERE event_id = ?',
      [event.event_id],
    );
    expect(row?.payload_json).toBeDefined();
    expect(row?.payload_json).not.toContain('sk-abc123456789012345678901234567890');
    expect(row?.payload_json).toContain('[REDACTED]');
  });

  it('redacted content is still searchable by non-secret terms', () => {
    const results: SearchResult[] = handleSearch('OPENAI', {
      db: adapter,
      semantic,
      fts5: false,
    });

    const convResults = results.filter((r) => r.layer === 'conversation');
    expect(convResults.length).toBeGreaterThan(0);
  });

  it('secrets do not appear in any stored payload', () => {
    // Verify that no conversation_events row contains the raw secret
    const rows = adapter.all<ConversationEventRow>(
      'SELECT payload_json FROM conversation_events WHERE payload_json LIKE ?',
      ['%sk-abc123456789012345678901234567890%'],
    );
    expect(rows).toHaveLength(0);
  });
});
