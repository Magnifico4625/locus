import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import { handleRemember } from '../../src/tools/remember.js';

const fixturesDir = join(import.meta.dirname, '..', '..', '..', 'codex', 'tests', 'fixtures');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-auto-search-'));
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

describe('memory_search auto-import integration', () => {
  it('auto-imports the newest Codex rollout before search', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    cpSync(join(fixturesDir, 'basic-session.jsonl'), join(sessionsDir, 'rollout-basic.jsonl'));

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'full';
    process.env.LOCUS_CAPTURE_LEVEL = 'full';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      const searchText = await callTextTool(ctx, 'memory_search', { query: 'parser test' });
      const results = JSON.parse(searchText) as Array<{ layer: string; content: string }>;

      const rows =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;

      expect(rows).toBe(4);
      expect(
        results.some(
          (entry) =>
            entry.layer === 'conversation' &&
            (entry.content.includes('parser test') ||
              entry.content.includes('Create a simple parser test')),
        ),
      ).toBe(true);
    } finally {
      ctx.cleanup();
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalCodexCapture === undefined) {
        delete process.env.LOCUS_CODEX_CAPTURE;
      } else {
        process.env.LOCUS_CODEX_CAPTURE = originalCodexCapture;
      }
      if (originalCaptureLevel === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = originalCaptureLevel;
      }
    }
  });

  it('debounces repeated search-triggered imports and keeps conversation row count stable', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    cpSync(join(fixturesDir, 'tool-session.jsonl'), join(sessionsDir, 'rollout-tool.jsonl'));

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'full';
    process.env.LOCUS_CAPTURE_LEVEL = 'full';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      const firstSearch = await callTextTool(ctx, 'memory_search', { query: 'shell_command' });
      const rowsAfterFirst =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;

      const secondSearch = await callTextTool(ctx, 'memory_search', { query: 'shell_command' });
      const rowsAfterSecond =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;

      const firstResults = JSON.parse(firstSearch) as Array<{ layer: string }>;
      const secondResults = JSON.parse(secondSearch) as Array<{ layer: string }>;

      expect(rowsAfterFirst).toBe(4);
      expect(rowsAfterSecond).toBe(rowsAfterFirst);
      expect(firstResults.some((entry) => entry.layer === 'conversation')).toBe(true);
      expect(secondResults.some((entry) => entry.layer === 'conversation')).toBe(true);
    } finally {
      ctx.cleanup();
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalCodexCapture === undefined) {
        delete process.env.LOCUS_CODEX_CAPTURE;
      } else {
        process.env.LOCUS_CODEX_CAPTURE = originalCodexCapture;
      }
      if (originalCaptureLevel === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = originalCaptureLevel;
      }
    }
  });

  it('keeps search usable when Codex auto-import fails', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    cpSync(join(fixturesDir, 'basic-session.jsonl'), join(sessionsDir, 'rollout-basic.jsonl'));

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'off';
    process.env.LOCUS_CAPTURE_LEVEL = 'metadata';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      handleRemember('Search fallback still works', ['phase-3'], { semantic: ctx.semantic });

      const searchText = await callTextTool(ctx, 'memory_search', {
        query: 'Search fallback still works',
      });
      const results = JSON.parse(searchText) as Array<{ layer: string; content: string }>;

      const codexRows =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;

      expect(codexRows).toBe(0);
      expect(
        results.some(
          (entry) =>
            entry.layer === 'semantic' && entry.content.includes('Search fallback still works'),
        ),
      ).toBe(true);
    } finally {
      ctx.cleanup();
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalCodexCapture === undefined) {
        delete process.env.LOCUS_CODEX_CAPTURE;
      } else {
        process.env.LOCUS_CODEX_CAPTURE = originalCodexCapture;
      }
      if (originalCaptureLevel === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = originalCaptureLevel;
      }
    }
  });
});
