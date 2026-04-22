import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-review-flow-'));
  tempRoots.push(dir);
  return dir;
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

describe('memory_review integration', () => {
  it('returns advisory cleanup candidates through the MCP server without deleting them', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
    const durable = new DurableMemoryStore(ctx.db, ctx.fts5);

    try {
      const stale = durable.insert({
        topicKey: 'coding_style',
        memoryType: 'style',
        state: 'stale',
        summary: 'Prefer long block comments in every file.',
        evidence: { source: 'test' },
        source: 'manual',
      });
      durable.insert({
        topicKey: 'auth_strategy',
        memoryType: 'decision',
        state: 'archivable',
        summary: 'GitHub OAuth is the current auth strategy.',
        evidence: { source: 'test' },
        source: 'codex',
      });

      const beforeCount =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;
      const reviewText = await callTextTool(ctx, 'memory_review', {
        state: 'stale',
        topicKey: 'coding_style',
      });
      const afterCount =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;
      const result = JSON.parse(reviewText) as {
        totalCandidates: number;
        countsByState: Record<string, number>;
        candidates: Array<Record<string, unknown>>;
      };

      expect(result.totalCandidates).toBe(1);
      expect(result.countsByState).toMatchObject({
        stale: 1,
        archivable: 1,
      });
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durableId: stale.id,
          state: 'stale',
          reason: 'stale_low_value',
          recommendedAction: 'review',
        }),
      ]);
      expect(beforeCount).toBe(afterCount);
    } finally {
      ctx.cleanup();
    }
  });
});
