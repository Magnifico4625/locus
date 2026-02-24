import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateDecisions } from '../../src/resources/decisions.js';
import { generateProjectMap } from '../../src/resources/project-map.js';
import { generateRecent } from '../../src/resources/recent.js';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import { handleRemember } from '../../src/tools/remember.js';
import { handleSearch } from '../../src/tools/search.js';
import { handleStatus } from '../../src/tools/status.js';
import type { MemoryStatus, SearchResult } from '../../src/types.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

// ─── Shared context ───────────────────────────────────────────────────────────

let tempDir: string;
let ctx: ServerContext;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'locus-server-test-'));
  const dbPath = join(tempDir, 'locus.db');
  // Use the temp dir as cwd so resolveProjectRoot falls back to cwd-fallback
  ctx = await createServer({ cwd: tempDir, dbPath });
});

afterAll(() => {
  ctx.cleanup();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createServer', () => {
  it('initialises properly — returns a valid ServerContext', () => {
    expect(ctx.server).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.semantic).toBeDefined();
    expect(ctx.episodic).toBeDefined();
    expect(typeof ctx.cleanup).toBe('function');
    // Backend must be one of the two known values
    expect(['node:sqlite', 'sql.js']).toContain(ctx.backend);
    // fts5 must be a boolean
    expect(typeof ctx.fts5).toBe('boolean');
    // projectRoot is a non-empty string
    expect(typeof ctx.projectRoot).toBe('string');
    expect(ctx.projectRoot.length).toBeGreaterThan(0);
    // projectRootMethod is one of the three known values
    expect(['git-root', 'project-marker', 'cwd-fallback']).toContain(ctx.projectRootMethod);
  });

  it('resources return formatted strings — not stub text', () => {
    // project-map: empty DB returns "No files scanned yet."
    const projectMapText = generateProjectMap(ctx.db, 'test-project');
    expect(projectMapText).toBeTypeOf('string');
    expect(projectMapText).not.toContain('not yet wired');
    expect(projectMapText.length).toBeGreaterThan(0);

    // decisions: empty DB returns "No decisions recorded yet."
    const decisionsText = generateDecisions(ctx.db);
    expect(decisionsText).toBeTypeOf('string');
    expect(decisionsText).not.toContain('not yet wired');
    expect(decisionsText.length).toBeGreaterThan(0);

    // recent: empty DB returns a meaningful message
    const recentText = generateRecent(ctx.db);
    expect(recentText).toBeTypeOf('string');
    expect(recentText).not.toContain('not yet wired');
    expect(recentText.length).toBeGreaterThan(0);
  });

  it('memory_remember stores an entry and memory_search finds it via SemanticMemory', () => {
    // Use the real SemanticMemory from context
    const entry = ctx.semantic.add('Use dependency injection for testability', ['architecture']);
    expect(entry.id).toBeGreaterThan(0);

    // Search using semantic memory directly (exercises the same code path as the tool)
    const results = ctx.semantic.search('dependency injection');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain('dependency injection');
  });

  it('memory_remember then memory_search via handleSearch finds the stored entry', () => {
    // Store a new unique memory using the real tool handler
    const entry = handleRemember(
      'Always prefer composition over inheritance in OOP designs',
      ['oop', 'design'],
      { semantic: ctx.semantic },
    );
    expect(entry.id).toBeGreaterThan(0);

    // Search via the real handleSearch handler — should find it across all layers
    const results: SearchResult[] = handleSearch('composition over inheritance', {
      db: ctx.db,
      semantic: ctx.semantic,
      fts5: ctx.fts5,
    });

    const found = results.find((r) => r.content.includes('composition over inheritance'));
    expect(found).toBeDefined();
    expect(found?.layer).toBe('semantic');
    expect(found?.relevance).toBeGreaterThan(0);
  });

  it('memory_status returns a valid MemoryStatus object with correct fields', () => {
    const status: MemoryStatus = handleStatus({
      projectPath: tempDir,
      projectRoot: ctx.projectRoot,
      projectRootMethod: ctx.projectRootMethod,
      dbPath: join(tempDir, 'locus.db'),
      db: ctx.db,
      config: LOCUS_DEFAULTS,
      backend: ctx.backend,
      fts5: ctx.fts5,
    });

    // All required fields must be present and typed correctly
    expect(status.projectPath).toBe(tempDir);
    expect(status.projectRoot).toBe(ctx.projectRoot);
    expect(status.projectRootMethod).toBe(ctx.projectRootMethod);
    expect(typeof status.dbSizeBytes).toBe('number');
    expect(status.captureLevel).toBe('metadata');
    expect(typeof status.totalFiles).toBe('number');
    expect(typeof status.totalMemories).toBe('number');
    expect(typeof status.totalEpisodes).toBe('number');
    expect(typeof status.lastScan).toBe('number');
    expect(typeof status.scanStrategy).toBe('string');
    expect(status.storageBackend).toBe(ctx.backend);
    expect(status.fts5Available).toBe(ctx.fts5);
    expect(status.nodeVersion).toMatch(/^v\d+\./);
    // Memories added in previous tests must be counted
    expect(status.totalMemories).toBeGreaterThan(0);
  });

  it('cleanup closes the DB without throwing', async () => {
    // Create an isolated server instance whose cleanup we can call without
    // destroying the shared ctx used by the other tests in this suite.
    const isolatedDbPath = join(tempDir, 'isolated.db');
    const ctx2 = await createServer({ cwd: tempDir, dbPath: isolatedDbPath });
    expect(() => ctx2.cleanup()).not.toThrow();
  });

  it('createServer with explicit dbPath uses that path directly', async () => {
    const explicitDbPath = join(tempDir, 'explicit.db');
    const ctx2 = await createServer({ cwd: tempDir, dbPath: explicitDbPath });
    try {
      // Server must be fully functional
      expect(ctx2.db).toBeDefined();
      expect(ctx2.server).toBeDefined();
      // Data round-trip through the explicit DB
      const entry = ctx2.semantic.add('Explicit DB path test', []);
      expect(entry.id).toBeGreaterThan(0);
      const found = ctx2.semantic.search('Explicit DB');
      expect(found.length).toBeGreaterThan(0);
    } finally {
      ctx2.cleanup();
    }
  });

  it('reads LOCUS_CAPTURE_LEVEL from environment', async () => {
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'redacted';
      const ctx2 = await createServer({ cwd: tempDir, dbPath: join(tempDir, 'capture-test.db') });
      try {
        expect(ctx2.config.captureLevel).toBe('redacted');
      } finally {
        ctx2.cleanup();
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('ignores invalid LOCUS_CAPTURE_LEVEL values', async () => {
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'invalid';
      const ctx2 = await createServer({
        cwd: tempDir,
        dbPath: join(tempDir, 'capture-invalid.db'),
      });
      try {
        expect(ctx2.config.captureLevel).toBe('metadata');
      } finally {
        ctx2.cleanup();
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });
});
