import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import type { DoctorReport } from '../../src/types.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'locus-track-a-diagnostics-'));
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

describe('Track A desktop diagnostics truth', () => {
  it('keeps status and doctor honest when metadata capture cannot promise strong recall or desktop parity', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions', '2026', '04');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    cpSync(
      join(fixturesDir, 'recall-decisions.jsonl'),
      join(sessionsDir, 'rollout-track-a-metadata.jsonl'),
    );

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'metadata';
    process.env.LOCUS_CAPTURE_LEVEL = 'metadata';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });

    try {
      await callTextTool(ctx, 'memory_search', { query: 'GitHub OAuth' });

      const statusText = await callTextTool(ctx, 'memory_status', {});
      const status = JSON.parse(statusText) as Record<string, unknown>;
      const truth = status.codexTruth as Record<string, unknown> | undefined;
      const doctorText = await callTextTool(ctx, 'memory_doctor', {});
      const report = JSON.parse(doctorText) as DoctorReport;

      expect(truth).toMatchObject({
        recallReadiness: 'limited',
        recommendedCaptureMode: 'redacted',
        desktopParity: 'unverified',
      });
      expect(typeof truth?.recallMessage).toBe('string');
      expect(typeof truth?.desktopMessage).toBe('string');
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Codex recall readiness',
            status: 'warn',
          }),
          expect.objectContaining({
            name: 'Codex desktop parity',
            status: 'warn',
          }),
        ]),
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
