import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleSearch } from '../../src/tools/search.js';
import type { DatabaseAdapter } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

// ─── Helper: insert a file row ────────────────────────────────────────────────

function insertFile(
  db: DatabaseAdapter,
  path: string,
  opts?: {
    exportsJson?: string;
    importsJson?: string;
  },
): void {
  db.run(
    `INSERT INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, ?, ?, '[]', 'module', 'typescript', 100, 'high', null, ?, null)`,
    [path, opts?.exportsJson ?? '[]', opts?.importsJson ?? '[]', Math.floor(Date.now() / 1000)],
  );
}

// ─── Helper: insert an episodic memory directly ───────────────────────────────

function insertEpisodic(db: DatabaseAdapter, content: string, sessionId: string): void {
  const now = Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES (?, ?, null, ?, ?, ?)',
    ['episodic', content, now, now, sessionId],
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('handleSearch', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-search-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
    semantic = new SemanticMemory(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Finds structural results by export name match ──────────────────────

  it('finds structural results by export name match', () => {
    insertFile(adapter, 'src/auth/login.ts', {
      exportsJson: JSON.stringify([
        { name: 'loginUser', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });

    const results = handleSearch('loginUser', { db: adapter, semantic, fts5: true });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    expect(structural[0]?.content).toContain('loginUser');
    expect(structural[0]?.relevance).toBe(1.0);
  });

  // ── 2. Finds structural results by file path match ────────────────────────

  it('finds structural results by file path match', () => {
    insertFile(adapter, 'src/auth/login.ts');
    insertFile(adapter, 'src/users/profile.ts');

    const results = handleSearch('auth', { db: adapter, semantic, fts5: true });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    const paths = structural.map((r) => r.content);
    expect(paths.some((p) => p.includes('auth'))).toBe(true);
  });

  // ── 3. Finds semantic results from SemanticMemory ─────────────────────────

  it('finds semantic results from SemanticMemory', () => {
    semantic.add('Use Zod for runtime validation', ['zod', 'validation']);
    semantic.add('Always write tests first', ['tdd']);

    const results = handleSearch('Zod', { db: adapter, semantic, fts5: true });

    const semanticResults = results.filter((r) => r.layer === 'semantic');
    expect(semanticResults.length).toBeGreaterThan(0);
    expect(semanticResults[0]?.content).toContain('Zod');
    expect(semanticResults[0]?.relevance).toBe(0.8);
    expect(semanticResults[0]?.source).toMatch(/^memory:\d+$/);
  });

  // ── 4. Finds episodic results from episodic entries ───────────────────────

  it('finds episodic results from episodic memories', () => {
    insertEpisodic(adapter, 'user asked about TypeScript configuration', 'session-abc');
    insertEpisodic(adapter, 'unrelated event log', 'session-abc');

    const results = handleSearch('TypeScript', { db: adapter, semantic, fts5: true });

    const episodic = results.filter((r) => r.layer === 'episodic');
    expect(episodic.length).toBeGreaterThan(0);
    expect(episodic[0]?.content).toContain('TypeScript');
    expect(episodic[0]?.relevance).toBe(0.6);
    expect(episodic[0]?.source).toContain('session:');
  });

  // ── 5. Returns results sorted by relevance DESC ───────────────────────────

  it('returns results sorted by relevance DESC', () => {
    // Export match (1.0) + semantic (0.8) + episodic (0.6) + path match (0.5)
    insertFile(adapter, 'src/search-module/index.ts', {
      exportsJson: JSON.stringify([
        { name: 'searchItems', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });
    semantic.add('search strategy decisions', []);
    insertEpisodic(adapter, 'searched for search functionality', 'session-1');

    const results = handleSearch('search', { db: adapter, semantic, fts5: true });

    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]?.relevance).toBeGreaterThanOrEqual(results[i]?.relevance ?? 0);
    }
  });

  // ── 6. Returns empty array for no matches ─────────────────────────────────

  it('returns empty array when nothing matches the query', () => {
    insertFile(adapter, 'src/auth/login.ts');
    semantic.add('Use Zod for validation', []);
    insertEpisodic(adapter, 'some event', 'session-1');

    const results = handleSearch('xyznonexistentquery123', { db: adapter, semantic, fts5: true });

    expect(results).toEqual([]);
  });

  // ── 7. Limits total results to 20 ────────────────────────────────────────

  it('limits total results to 20', () => {
    // Insert 15 files each with a matching export
    for (let i = 0; i < 15; i++) {
      insertFile(adapter, `src/module${i}/index.ts`, {
        exportsJson: JSON.stringify([
          { name: `targetFunc${i}`, kind: 'function', isDefault: false, isTypeOnly: false },
        ]),
      });
    }
    // Insert 10 semantic memories
    for (let i = 0; i < 10; i++) {
      semantic.add(`target decision number ${i}`, []);
    }
    // Insert 5 episodic entries
    for (let i = 0; i < 5; i++) {
      insertEpisodic(adapter, `target episodic event ${i}`, 'session-bulk');
    }

    const results = handleSearch('target', { db: adapter, semantic, fts5: true });

    expect(results.length).toBeLessThanOrEqual(20);
  });

  // ── 8. Export name match has higher relevance than path match ─────────────

  it('export name match has higher relevance than path match', () => {
    // File with matching export name
    insertFile(adapter, 'src/api/users.ts', {
      exportsJson: JSON.stringify([
        { name: 'getUser', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });
    // File with matching path only (no export match)
    insertFile(adapter, 'src/getUser-helper/utils.ts');

    const results = handleSearch('getUser', { db: adapter, semantic, fts5: true });

    const exportMatch = results.find((r) => r.layer === 'structural' && r.relevance === 1.0);
    const pathMatch = results.find((r) => r.layer === 'structural' && r.relevance === 0.5);

    expect(exportMatch).toBeDefined();
    expect(pathMatch).toBeDefined();
    expect((exportMatch?.relevance ?? 0) > (pathMatch?.relevance ?? 1)).toBe(true);
  });

  // ── Additional: episodic source includes session_id ───────────────────────

  it('episodic results include the correct session_id in source', () => {
    insertEpisodic(adapter, 'user ran the deploy command', 'session-deploy-42');

    const results = handleSearch('deploy', { db: adapter, semantic, fts5: true });

    const episodic = results.filter((r) => r.layer === 'episodic');
    expect(episodic.length).toBe(1);
    expect(episodic[0]?.source).toBe('session:session-deploy-42');
  });

  // ── Additional: structural path match content is the file path ────────────

  it('structural path match content is the file path itself', () => {
    insertFile(adapter, 'src/authentication/session.ts');

    const results = handleSearch('authentication', { db: adapter, semantic, fts5: true });

    const pathMatch = results.find((r) => r.layer === 'structural' && r.relevance === 0.5);
    expect(pathMatch?.content).toBe('src/authentication/session.ts');
  });
});
