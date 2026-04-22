import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-durable-flow-'));
  tempRoots.push(dir);
  return dir;
}

function makeCodexInboxEvent(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    event_id: `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'codex',
    project_root: 'C:/Projects/Locus',
    session_id: 'sess-durable-001',
    timestamp: Date.now(),
    kind: 'session_end',
    payload: {
      summary: 'Decision: use SQLite for the local durable memory store.',
    },
    ...overrides,
  };
}

function getRegisteredTool(ctx: ServerContext, name: string) {
  const registry = (
    ctx.server as {
      _registeredTools?: Record<
        string,
        { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }
      >;
    }
  )._registeredTools;
  const tool = registry?.[name];
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

async function callTextTool(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = getRegisteredTool(ctx, name);
  const result = await tool.handler(args);
  return result.content[0]?.text ?? '';
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('durable extraction flow integration', () => {
  it('extracts durable memories from Codex events processed at startup', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const inboxDir = join(root, 'inbox');

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    const event = makeCodexInboxEvent({ event_id: 'startup-codex-decision-001' });
    writeFileSync(join(inboxDir, `${event.timestamp}-startup.json`), JSON.stringify(event), 'utf-8');

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const durableCount =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;
      const durableRow = ctx.db.get<{ topic_key: string | null; summary: string }>(
        'SELECT topic_key, summary FROM durable_memories ORDER BY id DESC LIMIT 1',
      );
      const watermark = ctx.db.get<{ value: string }>(
        'SELECT value FROM scan_state WHERE key = ?',
        ['durable.codex.last_event_id'],
      );

      expect(durableCount).toBe(1);
      expect(durableRow?.topic_key).toBe('database_choice');
      expect(durableRow?.summary).toContain('SQLite');
      expect(Number(watermark?.value ?? '0')).toBeGreaterThan(0);
    } finally {
      ctx.cleanup();
    }
  });

  it('extracts durable memories during pre-search inbox processing without duplicating them on repeat search', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      mkdirSync(ctx.inboxDir, { recursive: true });
      const event = makeCodexInboxEvent({ event_id: 'search-codex-decision-001' });
      writeFileSync(join(ctx.inboxDir, `${event.timestamp}-search.json`), JSON.stringify(event), 'utf-8');

      await callTextTool(ctx, 'memory_search', { query: 'SQLite durable memory store' });
      const firstCount =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;

      await callTextTool(ctx, 'memory_search', { query: 'SQLite durable memory store' });
      const secondCount =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;

      expect(firstCount).toBe(1);
      expect(secondCount).toBe(firstCount);
    } finally {
      ctx.cleanup();
    }
  });
});
