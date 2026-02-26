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

// ─── captureLevelGate ───

describe('captureLevelGate', () => {
  it('drops user_prompt at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'user_prompt', payload: { prompt: 'hello world' } });
    expect(captureLevelGate(event, 'metadata')).toBe(false);
  });

  it('drops ai_response at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'ai_response', payload: { response: 'sure thing' } });
    expect(captureLevelGate(event, 'metadata')).toBe(false);
  });

  it('allows tool_use at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'tool_use' });
    expect(captureLevelGate(event, 'metadata')).toBe(true);
  });

  it('allows file_diff at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'file_diff',
      payload: { path: 'src/a.ts', added: 5, removed: 2 },
    });
    expect(captureLevelGate(event, 'metadata')).toBe(true);
  });

  it('allows session_start at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'session_start', payload: { tool: 'claude-code' } });
    expect(captureLevelGate(event, 'metadata')).toBe(true);
  });

  it('allows session_end at metadata level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'session_end', payload: {} });
    expect(captureLevelGate(event, 'metadata')).toBe(true);
  });

  it('allows user_prompt at full level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'user_prompt', payload: { prompt: 'hello world' } });
    expect(captureLevelGate(event, 'full')).toBe(true);
  });

  it('allows ai_response at full level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'ai_response', payload: { response: 'sure' } });
    expect(captureLevelGate(event, 'full')).toBe(true);
  });

  it('allows user_prompt at redacted level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'user_prompt', payload: { prompt: 'hello' } });
    expect(captureLevelGate(event, 'redacted')).toBe(true);
  });

  it('allows all event kinds at full level', async () => {
    const { captureLevelGate } = await import('../../src/ingest/filters.js');
    const kinds = [
      'user_prompt',
      'ai_response',
      'tool_use',
      'file_diff',
      'session_start',
      'session_end',
    ] as const;
    for (const kind of kinds) {
      const event = makeEvent({ kind, payload: {} });
      expect(captureLevelGate(event, 'full')).toBe(true);
    }
  });
});

// ─── classifySignificance ───

describe('classifySignificance', () => {
  it('classifies short prompt (< 5 words) as low', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'user_prompt', payload: { prompt: 'fix bug' } });
    expect(classifySignificance(event)).toBe('low');
  });

  it('classifies medium-length prompt (5-50 words) as medium', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'user_prompt',
      payload: { prompt: 'please add a new login endpoint to the auth module' },
    });
    expect(classifySignificance(event)).toBe('medium');
  });

  it('classifies long prompt (> 50 words) as high', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const words = Array.from({ length: 55 }, (_, i) => `word${i}`).join(' ');
    const event = makeEvent({ kind: 'user_prompt', payload: { prompt: words } });
    expect(classifySignificance(event)).toBe('high');
  });

  it('classifies file creation (Write tool) as high', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Write', files: ['src/new-file.ts'], status: 'success' },
    });
    expect(classifySignificance(event)).toBe('high');
  });

  it('classifies test failure (error status) as high', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Bash', files: [], status: 'error', exitCode: 1 },
    });
    expect(classifySignificance(event)).toBe('high');
  });

  it('classifies successful tool_use (Read) as medium', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Read', files: ['src/index.ts'], status: 'success' },
    });
    expect(classifySignificance(event)).toBe('medium');
  });

  it('classifies file_diff as medium', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'file_diff',
      payload: { path: 'src/app.ts', added: 10, removed: 3 },
    });
    expect(classifySignificance(event)).toBe('medium');
  });

  it('classifies ai_response as medium', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'ai_response',
      payload: { response: 'Here is the fix for your authentication issue...' },
    });
    expect(classifySignificance(event)).toBe('medium');
  });

  it('classifies session_start as low', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'session_start',
      payload: { tool: 'claude-code' },
    });
    expect(classifySignificance(event)).toBe('low');
  });

  it('classifies session_end as low', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'session_end',
      payload: {},
    });
    expect(classifySignificance(event)).toBe('low');
  });

  it('classifies Edit tool as high (file modification)', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Edit', files: ['src/config.ts'], status: 'success' },
    });
    expect(classifySignificance(event)).toBe('high');
  });

  it('handles missing prompt field gracefully', async () => {
    const { classifySignificance } = await import('../../src/ingest/filters.js');
    const event = makeEvent({ kind: 'user_prompt', payload: {} });
    expect(classifySignificance(event)).toBe('low');
  });
});

// ─── shouldDedup ───

describe('shouldDedup', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-filters-'));
    adapter = createAdapter(tempDir);
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when no recent similar events exist', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'user_prompt',
      payload: { prompt: 'add authentication module' },
    });
    expect(shouldDedup(event, adapter)).toBe(false);
  });

  it('returns true for identical prompt within 5 minutes', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const now = Date.now();

    // Insert a recent event with same prompt
    adapter.run(
      `INSERT INTO conversation_events
       (event_id, source, project_root, timestamp, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'existing-001',
        'claude-code',
        '/home/user/myapp',
        now - 60000,
        'user_prompt',
        JSON.stringify({ prompt: 'add authentication module' }),
        now - 60000,
      ],
    );

    const event = makeEvent({
      kind: 'user_prompt',
      timestamp: now,
      payload: { prompt: 'add authentication module' },
    });
    expect(shouldDedup(event, adapter)).toBe(true);
  });

  it('returns false for identical prompt beyond 5 minutes', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const now = Date.now();

    // Insert an old event (10 minutes ago)
    adapter.run(
      `INSERT INTO conversation_events
       (event_id, source, project_root, timestamp, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'existing-002',
        'claude-code',
        '/home/user/myapp',
        now - 600000,
        'user_prompt',
        JSON.stringify({ prompt: 'add authentication module' }),
        now - 600000,
      ],
    );

    const event = makeEvent({
      kind: 'user_prompt',
      timestamp: now,
      payload: { prompt: 'add authentication module' },
    });
    expect(shouldDedup(event, adapter)).toBe(false);
  });

  it('returns false for different prompts within 5 minutes', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const now = Date.now();

    adapter.run(
      `INSERT INTO conversation_events
       (event_id, source, project_root, timestamp, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'existing-003',
        'claude-code',
        '/home/user/myapp',
        now - 60000,
        'user_prompt',
        JSON.stringify({ prompt: 'different prompt entirely' }),
        now - 60000,
      ],
    );

    const event = makeEvent({
      kind: 'user_prompt',
      timestamp: now,
      payload: { prompt: 'add authentication module' },
    });
    expect(shouldDedup(event, adapter)).toBe(false);
  });

  it('returns false for non-prompt events (no similarity dedup)', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const event = makeEvent({
      kind: 'tool_use',
      payload: { tool: 'Bash', files: [], status: 'success' },
    });
    expect(shouldDedup(event, adapter)).toBe(false);
  });

  it('deduplicates same file_diff path within 5 minutes', async () => {
    const { shouldDedup } = await import('../../src/ingest/filters.js');
    const now = Date.now();

    adapter.run(
      `INSERT INTO conversation_events
       (event_id, source, project_root, timestamp, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'existing-004',
        'claude-code',
        '/home/user/myapp',
        now - 60000,
        'file_diff',
        JSON.stringify({ path: 'src/app.ts', added: 5, removed: 2 }),
        now - 60000,
      ],
    );

    const event = makeEvent({
      kind: 'file_diff',
      timestamp: now,
      payload: { path: 'src/app.ts', added: 3, removed: 1 },
    });
    expect(shouldDedup(event, adapter)).toBe(true);
  });
});
