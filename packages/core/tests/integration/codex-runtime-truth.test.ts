import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePathForIdentity } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import { handleRemember } from '../../src/tools/remember.js';
import type { MemoryStatus, SearchResult } from '../../src/types.js';

const fixturesDir = join(import.meta.dirname, '..', '..', '..', 'codex', 'tests', 'fixtures');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-runtime-truth-'));
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

describe('Codex runtime truth integration', () => {
  it('reports structured Codex runtime truth and normalized diagnostics after auto-import', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions', '2026', '04');
    const rolloutPath = join(sessionsDir, 'rollout-2026-04-21T09-00-00.jsonl');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    cpSync(join(fixturesDir, 'basic-session.jsonl'), rolloutPath);

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'full';
    process.env.LOCUS_CAPTURE_LEVEL = 'full';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      await callTextTool(ctx, 'memory_search', { query: 'parser test' });

      const statusText = await callTextTool(ctx, 'memory_status', {});
      const status = JSON.parse(statusText) as MemoryStatus;

      expect(status.codexAutoImport).toMatchObject({
        clientDetected: true,
        client: 'codex',
        clientSurface: 'cli',
        detectionEvidence: ['env:CODEX_HOME'],
      });
      expect(['imported', 'duplicates_only']).toContain(status.codexAutoImport?.lastStatus);
      expect(
        (status.codexAutoImport?.lastImported ?? 0) + (status.codexAutoImport?.lastDuplicates ?? 0),
      ).toBeGreaterThan(0);

      expect(status.codexDiagnostics).toMatchObject({
        client: 'codex',
        clientSurface: 'cli',
        detectionEvidence: ['env:CODEX_HOME'],
        sessionsDir: normalizePathForIdentity(join(codexHome, 'sessions')),
        sessionsDirExists: true,
        latestRolloutPath: normalizePathForIdentity(rolloutPath),
        latestRolloutReadable: true,
      });
      expect((status.codexDiagnostics?.rolloutFilesFound ?? 0) > 0).toBe(true);
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

  it('stays generic when CODEX_HOME is absent', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });

    const originalCodexHome = process.env.CODEX_HOME;

    delete process.env.CODEX_HOME;

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      handleRemember('Generic runtime truth still searches', ['generic-runtime'], {
        semantic: ctx.semantic,
      });

      const searchText = await callTextTool(ctx, 'memory_search', {
        query: 'Generic runtime truth still searches',
      });
      const results = JSON.parse(searchText) as SearchResult[];
      const statusText = await callTextTool(ctx, 'memory_status', {});
      const status = JSON.parse(statusText) as MemoryStatus;

      expect(
        results.some(
          (entry) =>
            entry.layer === 'semantic' &&
            entry.content.includes('Generic runtime truth still searches'),
        ),
      ).toBe(true);
      expect(status.codexAutoImport).toMatchObject({
        clientDetected: false,
        client: 'generic',
        clientSurface: 'generic',
        detectionEvidence: ['fallback:generic'],
        lastStatus: 'skipped_not_codex',
      });
      expect(status.codexDiagnostics).toBeUndefined();
    } finally {
      ctx.cleanup();
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });
});
