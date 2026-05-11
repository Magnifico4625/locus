import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServer, type ServerContext } from '../../src/server.js';
import type { MemoryImportCodexResponse, MemoryRecallResult } from '../../src/types.js';

const fixturesDir = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'codex',
  'tests',
  'fixtures',
  'track-c',
);

const tempRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function getRegisteredTool(ctx: ServerContext, name: string) {
  const registry = (
    ctx.server as {
      _registeredTools?: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
    }
  )._registeredTools;
  const tool = registry?.[name];
  if (!tool) {
    throw new Error(`Tool not registered: ${name}`);
  }
  return tool.handler;
}

async function callTextTool(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = (await getRegisteredTool(ctx, name)(args)) as {
    content?: Array<{ text?: string }>;
  };
  return result.content?.[0]?.text ?? '';
}

async function callJsonTool<T>(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return JSON.parse(await callTextTool(ctx, name, args)) as T;
}

function copyFixtureSessions(codexHome: string): void {
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(sessionsDir, { recursive: true });

  cpSync(
    join(fixturesDir, 'multi-task-russian.jsonl'),
    join(sessionsDir, 'rollout-2026-05-08-090000.jsonl'),
  );
  cpSync(
    join(fixturesDir, 'decision-rejected-alternative.jsonl'),
    join(sessionsDir, 'rollout-2026-05-08-110000.jsonl'),
  );
  cpSync(
    join(fixturesDir, 'style-preference-validation.jsonl'),
    join(sessionsDir, 'rollout-2026-05-08-130000.jsonl'),
  );
}

async function withTrackCServer<T>(fn: (ctx: ServerContext) => Promise<T>): Promise<T> {
  const previousEnv = {
    CODEX_HOME: process.env.CODEX_HOME,
    LOCUS_CODEX_CAPTURE: process.env.LOCUS_CODEX_CAPTURE,
    LOCUS_CAPTURE_LEVEL: process.env.LOCUS_CAPTURE_LEVEL,
  };

  const root = mkdtempSync(join(tmpdir(), 'locus-track-c-recall-'));
  tempRoots.push(root);
  const codexHome = join(root, 'codex-home');
  const projectDir = join(root, 'project');
  mkdirSync(projectDir, { recursive: true });
  copyFixtureSessions(codexHome);

  process.env.CODEX_HOME = codexHome;
  process.env.LOCUS_CODEX_CAPTURE = 'redacted';
  process.env.LOCUS_CAPTURE_LEVEL = 'redacted';
  vi.useFakeTimers({ now: new Date('2026-05-09T12:00:00.000Z') });

  let ctx: ServerContext | undefined;
  try {
    ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
    return await fn(ctx);
  } finally {
    await ctx?.cleanup();
    if (previousEnv.CODEX_HOME === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousEnv.CODEX_HOME;
    }
    if (previousEnv.LOCUS_CODEX_CAPTURE === undefined) {
      delete process.env.LOCUS_CODEX_CAPTURE;
    } else {
      process.env.LOCUS_CODEX_CAPTURE = previousEnv.LOCUS_CODEX_CAPTURE;
    }
    if (previousEnv.LOCUS_CAPTURE_LEVEL === undefined) {
      delete process.env.LOCUS_CAPTURE_LEVEL;
    } else {
      process.env.LOCUS_CAPTURE_LEVEL = previousEnv.LOCUS_CAPTURE_LEVEL;
    }
  }
}

function recallText(result: MemoryRecallResult): string {
  return [
    result.summary,
    ...result.candidates.map((candidate) => [candidate.headline, candidate.summary].join(' ')),
    ...(result.candidateGroups ?? []).flatMap((group) => [
      group.label,
      group.reason,
      ...group.candidates.map((candidate) => [candidate.headline, candidate.summary].join(' ')),
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function expectRecallContains(result: MemoryRecallResult, expected: string[]): void {
  const text = recallText(result);
  for (const fragment of expected) {
    expect(text).toContain(fragment.toLowerCase());
  }
}

describe('Track C redacted recall acceptance', () => {
  it('recalls high-value Codex dialogue facts from redacted transcript fixtures', async () => {
    await withTrackCServer(async (ctx) => {
      const imported = await callJsonTool<MemoryImportCodexResponse>(ctx, 'memory_import_codex', {
        since: Date.parse('2026-05-08T00:00:00.000Z'),
      });
      expect(imported.status).toBe('ok');
      expect(imported.imported).toBeGreaterThan(0);

      const yesterday = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что мы делали вчера?',
      });
      expect(['ok', 'needs_clarification']).toContain(yesterday.status);
      expectRecallContains(yesterday, ['redacted', 'hook-first', 'npm']);

      const captureStrategy = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что решили по capture strategy?',
      });
      expect(captureStrategy.status).toBe('ok');
      expectRecallContains(captureStrategy, ['redacted', 'rule-based']);

      const hookFirst = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'почему отказались от hook-first?',
      });
      expect(hookFirst.status).toBe('ok');
      expectRecallContains(hookFirst, ['hook-first', 'under development']);

      const style = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'какой у меня стиль работы?',
      });
      expect(style.status).toBe('ok');
      expectRecallContains(style, ['атомарного таска', 'одобрения']);

      const npmErrors = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'какие ошибки были при npm install?',
      });
      expect(npmErrors.status).toBe('ok');
      expectRecallContains(npmErrors, ['eresolve', 'dependency tree']);

      const nextSteps = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что осталось сделать?',
      });
      expect(nextSteps.status).toBe('ok');
      expectRecallContains(nextSteps, ['acceptance matrix', 'docs']);

      const validated = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что реально проверено?',
      });
      expect(validated.status).toBe('ok');
      expectRecallContains(validated, ['codex-install.test.ts', 'typecheck']);
    });
  });
});
