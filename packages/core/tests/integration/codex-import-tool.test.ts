import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importCodexSessionsToInbox } from '../../../codex/src/importer.js';
import { processInbox } from '../../src/ingest/pipeline.js';
import { createServer } from '../../src/server.js';
import { handleSearch } from '../../src/tools/search.js';
import { handleImportCodex } from '../../src/tools/import-codex.js';

const fixturesDir = join(import.meta.dirname, '..', '..', '..', 'codex', 'tests', 'fixtures');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-import-tool-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('handleImportCodex integration', () => {
  it('imports Codex sessions and makes them searchable immediately', async () => {
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
      const result = handleImportCodex(
        {},
        {
          db: ctx.db,
          inboxDir: ctx.inboxDir,
          captureLevel: ctx.config.captureLevel,
          fts5Available: ctx.fts5,
          env: {
            CODEX_HOME: codexHome,
            LOCUS_CODEX_CAPTURE: 'full',
            LOCUS_CAPTURE_LEVEL: 'full',
          },
          processInbox,
          importCodexSessionsToInbox,
        },
      );

      expect(result.status).toBe('ok');
      expect(result.imported).toBe(4);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.latestSession).toBe('sess_basic_001');

      const rows =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;
      expect(rows).toBe(4);

      const results = handleSearch('parser test', {
        db: ctx.db,
        semantic: ctx.semantic,
        fts5: ctx.fts5,
      });

      const conversationMatch = results.find(
        (entry) =>
          entry.layer === 'conversation' &&
          (entry.content.includes('parser test') || entry.content.includes('Create a simple parser test')),
      );
      expect(conversationMatch).toBeDefined();
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

  it('reports duplicates on repeated import and keeps conversation row count stable', async () => {
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
      const deps = {
        db: ctx.db,
        inboxDir: ctx.inboxDir,
        captureLevel: ctx.config.captureLevel,
        fts5Available: ctx.fts5,
        env: {
          CODEX_HOME: codexHome,
          LOCUS_CODEX_CAPTURE: 'full',
          LOCUS_CAPTURE_LEVEL: 'full',
        },
        processInbox,
        importCodexSessionsToInbox,
      };

      const first = handleImportCodex({}, deps);
      const rowsAfterFirst =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events')?.cnt ?? 0;

      const second = handleImportCodex({}, deps);
      const rowsAfterSecond =
        ctx.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events')?.cnt ?? 0;

      expect(first.status).toBe('ok');
      expect(first.imported).toBe(4);
      expect(first.duplicates).toBe(0);
      expect(rowsAfterFirst).toBe(4);

      expect(second.status).toBe('ok');
      expect(second.imported).toBe(0);
      expect(second.duplicates).toBe(4);
      expect(second.processed).toBe(0);
      expect(rowsAfterSecond).toBe(rowsAfterFirst);
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
