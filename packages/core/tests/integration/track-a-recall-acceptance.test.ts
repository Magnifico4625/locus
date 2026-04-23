import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import type { MemoryRecallResult, MemoryStatus } from '../../src/types.js';

const fixturesDir = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'codex',
  'tests',
  'fixtures',
  'track-a',
);
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-track-a-recall-'));
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

describe('Track A recall acceptance', () => {
  it('returns a useful summary-first answer for the recent bugfix fixture in redacted mode', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions', '2026', '04');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    cpSync(
      join(fixturesDir, 'recall-bugfix.jsonl'),
      join(sessionsDir, 'rollout-track-a-bugfix.jsonl'),
    );

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'redacted';
    process.env.LOCUS_CAPTURE_LEVEL = 'redacted';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we just fix in Codex recall?',
        limit: 1,
      });
      const recall = JSON.parse(recallText) as MemoryRecallResult;
      const statusText = await callTextTool(ctx, 'memory_status', {});
      const status = JSON.parse(statusText) as MemoryStatus;

      expect(recall.status).toBe('ok');
      expect(recall.summary).toContain('durable runner watermark recall gap');
      expect(recall.summary).toContain('repeated-search debounce');
      expect(recall.candidates).toEqual([
        expect.objectContaining({
          sessionId: 'sess_track_a_bugfix_001',
        }),
      ]);
      expect(status.codexDiagnostics).toMatchObject({
        captureMode: 'redacted',
      });
      expect(status.totalConversationEvents).toBeGreaterThan(0);
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

  it('includes a durable decision candidate for the track-a decision fixture', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions', '2026', '04');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    cpSync(
      join(fixturesDir, 'recall-decisions.jsonl'),
      join(sessionsDir, 'rollout-track-a-decisions.jsonl'),
    );

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'redacted';
    process.env.LOCUS_CAPTURE_LEVEL = 'redacted';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we decide about auth strategy?',
      });
      const recall = JSON.parse(recallText) as MemoryRecallResult;

      expect(['ok', 'needs_clarification']).toContain(recall.status);
      expect(
        recall.candidates.some((candidate) => candidate.headline.includes('GitHub OAuth')),
      ).toBe(true);
      expect(recall.candidates.some((candidate) => candidate.durableMemoryIds.length > 0)).toBe(
        true,
      );
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
