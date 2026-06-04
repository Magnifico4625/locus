import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function copyFixtureSession(
  sourceName: string,
  targetName: string,
  sessionsDir: string,
  projectDir: string,
): void {
  const sourcePath = join(fixturesDir, sourceName);
  const targetPath = join(sessionsDir, targetName);
  const source = readFileSync(sourcePath, 'utf8');
  const rewritten = source
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type !== 'session_meta') {
        return line;
      }

      return JSON.stringify({ ...parsed, cwd: projectDir });
    })
    .join('\n');

  writeFileSync(targetPath, rewritten, 'utf8');
}

function copyFixtureSessions(codexHome: string, projectDir: string): void {
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(sessionsDir, { recursive: true });

  copyFixtureSession(
    'multi-task-russian.jsonl',
    'rollout-2026-05-08-090000.jsonl',
    sessionsDir,
    projectDir,
  );
  copyFixtureSession(
    'decision-rejected-alternative.jsonl',
    'rollout-2026-05-08-110000.jsonl',
    sessionsDir,
    projectDir,
  );
  copyFixtureSession(
    'style-preference-validation.jsonl',
    'rollout-2026-05-08-130000.jsonl',
    sessionsDir,
    projectDir,
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
  copyFixtureSessions(codexHome, projectDir);

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

async function withImportedTrackCServer<T>(fn: (ctx: ServerContext) => Promise<T>): Promise<T> {
  return withTrackCServer(async (ctx) => {
    const imported = await callJsonTool<MemoryImportCodexResponse>(ctx, 'memory_import_codex', {
      since: Date.parse('2026-05-08T00:00:00.000Z'),
    });
    expect(imported.status).toBe('ok');
    expect(imported.imported).toBeGreaterThan(0);

    return await fn(ctx);
  });
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
  it('recalls yesterday as an overview across all Track C fixtures', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const yesterday = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что мы делали вчера?',
      });
      expect(['ok', 'needs_clarification']).toContain(yesterday.status);
      // The broad "yesterday" query intentionally proves recall can connect all fixture sessions.
      expectRecallContains(yesterday, ['redacted', 'hook-first', 'npm']);
    });
  });

  it('recalls the capture strategy decision', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const captureStrategy = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что решили по capture strategy?',
      });
      expect(captureStrategy.status).toBe('ok');
      expectRecallContains(captureStrategy, ['redacted', 'rule-based']);
    });
  });

  it('recalls the hook-first rejected alternative', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const hookFirst = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'почему отказались от hook-first?',
      });
      expect(hookFirst.status).toBe('ok');
      expectRecallContains(hookFirst, ['hook-first', 'under development']);
    });
  });

  it('recalls the user work style preference', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const style = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'какой у меня стиль работы?',
      });
      expect(style.status).toBe('ok');
      expectRecallContains(style, ['атомарного таска', 'одобрения']);
    });
  });

  it('recalls npm install error context', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const npmErrors = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'какие ошибки были при npm install?',
      });
      expect(npmErrors.status).toBe('ok');
      expectRecallContains(npmErrors, ['eresolve', 'dependency tree']);
    });
  });

  it('recalls documented next steps', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const nextSteps = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что осталось сделать?',
      });
      expect(nextSteps.status).toBe('ok');
      expectRecallContains(nextSteps, ['acceptance matrix', 'docs']);
    });
  });

  it('recalls validation facts', async () => {
    await withImportedTrackCServer(async (ctx) => {
      const validated = await callJsonTool<MemoryRecallResult>(ctx, 'memory_recall', {
        question: 'что реально проверено?',
      });
      expect(validated.status).toBe('ok');
      expectRecallContains(validated, ['codex-install.test.ts', 'typecheck']);
    });
  });
});
