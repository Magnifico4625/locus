import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleExplore } from '../../src/tools/explore.js';
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
    reExportsJson?: string;
    confidenceLevel?: string;
    fileType?: string;
  },
): void {
  db.run(
    `INSERT INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, ?, ?, ?, ?, 'typescript', 100, ?, null, ?, null)`,
    [
      path,
      opts?.exportsJson ?? '[]',
      opts?.importsJson ?? '[]',
      opts?.reExportsJson ?? '[]',
      opts?.fileType ?? 'module',
      opts?.confidenceLevel ?? 'high',
      Math.floor(Date.now() / 1000),
    ],
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('handleExplore', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-explore-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Returns formatted file info for direct children ────────────────────

  it('returns formatted file info for direct children of a directory', () => {
    insertFile(adapter, 'src/auth/login.ts', {
      exportsJson: JSON.stringify([
        { name: 'loginUser', kind: 'function', isDefault: false, isTypeOnly: false },
        { name: 'LoginSchema', kind: 'const', isDefault: false, isTypeOnly: false },
      ]),
      importsJson: JSON.stringify([
        { source: 'prisma', isTypeOnly: false, isDynamic: false },
        { source: 'bcrypt', isTypeOnly: false, isDynamic: false },
      ]),
      confidenceLevel: 'high',
    });

    const result = handleExplore('src/auth', { db: adapter });

    expect(result).toContain('login.ts');
    expect(result).toContain('loginUser');
    expect(result).toContain('LoginSchema');
    expect(result).toContain('confidence: high');
  });

  // ── 2. Does not include nested subdirectory files ─────────────────────────

  it('does not include nested subdirectory files (depth=1 only)', () => {
    insertFile(adapter, 'src/auth/login.ts');
    insertFile(adapter, 'src/auth/utils/helpers.ts'); // nested deeper

    const result = handleExplore('src/auth', { db: adapter });

    expect(result).toContain('login.ts');
    expect(result).not.toContain('helpers.ts');
  });

  // ── 3. Shows exports list for each file ───────────────────────────────────

  it('shows exports list for each file', () => {
    insertFile(adapter, 'src/utils/format.ts', {
      exportsJson: JSON.stringify([
        { name: 'formatDate', kind: 'function', isDefault: false, isTypeOnly: false },
        { name: 'formatCurrency', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });

    const result = handleExplore('src/utils', { db: adapter });

    expect(result).toContain('exports [formatDate, formatCurrency]');
  });

  // ── 4. Shows imports list for each file ───────────────────────────────────

  it('shows imports list for each file', () => {
    insertFile(adapter, 'src/api/users.ts', {
      exportsJson: JSON.stringify([
        { name: 'getUser', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
      importsJson: JSON.stringify([
        { source: 'prisma', isTypeOnly: false, isDynamic: false },
        { source: 'zod', isTypeOnly: false, isDynamic: false },
        { source: 'jwt', isTypeOnly: false, isDynamic: false },
      ]),
    });

    const result = handleExplore('src/api', { db: adapter });

    expect(result).toContain('imports [prisma, zod, jwt]');
  });

  // ── 5. Shows re-exports for barrel files ──────────────────────────────────

  it('shows re-exports for barrel files', () => {
    insertFile(adapter, 'src/auth/index.ts', {
      reExportsJson: JSON.stringify([
        { source: './login', names: '*' },
        { source: './register', names: '*' },
      ]),
      confidenceLevel: 'medium',
    });

    const result = handleExplore('src/auth', { db: adapter });

    expect(result).toContain('index.ts');
    expect(result).toContain('re-exports');
    expect(result).toContain('* from ./login');
    expect(result).toContain('* from ./register');
  });

  // ── 6. Shows confidence level ─────────────────────────────────────────────

  it('shows confidence level for each file', () => {
    insertFile(adapter, 'src/lib/parser.ts', {
      exportsJson: JSON.stringify([
        { name: 'parse', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
      confidenceLevel: 'medium',
    });

    const result = handleExplore('src/lib', { db: adapter });

    expect(result).toContain('confidence: medium');
  });

  // ── 7. Returns "No files found" message for empty/nonexistent path ────────

  it('returns "No files found" message for empty/nonexistent path', () => {
    insertFile(adapter, 'src/auth/login.ts');

    const result = handleExplore('src/nonexistent', { db: adapter });

    expect(result).toBe('No files found in src/nonexistent');
  });

  it('returns "No files found" message when DB has no files', () => {
    const result = handleExplore('src/auth', { db: adapter });

    expect(result).toBe('No files found in src/auth');
  });

  // ── 8. Handles root path (empty string) ───────────────────────────────────

  it('handles root path (empty string) — shows root-level files only', () => {
    insertFile(adapter, 'index.ts', {
      exportsJson: JSON.stringify([
        { name: 'main', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });
    insertFile(adapter, 'utils.ts');
    insertFile(adapter, 'src/nested.ts'); // nested, should be excluded

    const result = handleExplore('', { db: adapter });

    expect(result).toContain('index.ts');
    expect(result).toContain('utils.ts');
    expect(result).not.toContain('nested.ts');
  });

  it('handles root path "/" — shows root-level files only', () => {
    insertFile(adapter, 'config.ts');
    insertFile(adapter, 'src/app.ts'); // nested, should be excluded

    const result = handleExplore('/', { db: adapter });

    expect(result).toContain('config.ts');
    expect(result).not.toContain('app.ts');
  });

  it('returns "No files found in /" when root is empty', () => {
    // Insert only nested files
    insertFile(adapter, 'src/app.ts');

    const result = handleExplore('', { db: adapter });

    expect(result).toBe('No files found in /');
  });
});
