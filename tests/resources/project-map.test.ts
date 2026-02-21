import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateProjectMap } from '../../src/resources/project-map.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { DatabaseAdapter } from '../../src/types.js';
import { estimateTokens } from '../../src/utils.js';

// ─── Test DB setup ────────────────────────────────────────────────────────────

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
    language?: string;
    fileType?: string;
    confidence?: string;
    lines?: number;
    skippedReason?: string;
  },
): void {
  db.run(
    `INSERT INTO files (relative_path, exports_json, imports_json, re_exports_json, file_type, language, lines, confidence_level, confidence_reason, last_scanned, skipped_reason)
     VALUES (?, '[]', '[]', '[]', ?, ?, ?, ?, null, ?, ?)`,
    [
      path,
      opts?.fileType ?? 'module',
      opts?.language ?? 'typescript',
      opts?.lines ?? 50,
      opts?.confidence ?? 'high',
      Math.floor(Date.now() / 1000),
      opts?.skippedReason ?? null,
    ],
  );
}

// ─── Helper: insert scan state ────────────────────────────────────────────────

function setScanState(db: DatabaseAdapter, key: string, value: string): void {
  db.run('INSERT OR REPLACE INTO scan_state (key, value) VALUES (?, ?)', [key, value]);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('generateProjectMap', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-project-map-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Empty DB ──────────────────────────────────────────────────────────────

  it('returns "No files scanned yet." when the DB is empty', () => {
    const result = generateProjectMap(adapter, 'my-project');
    expect(result).toBe('No files scanned yet.');
  });

  // ── 2. Small project — file names listed ──────────────────────────────────────

  it('lists file names (without extensions) when a directory has <=8 files', () => {
    insertFile(adapter, 'src/auth/login.ts');
    insertFile(adapter, 'src/auth/register.ts');
    insertFile(adapter, 'src/auth/refresh.ts');
    insertFile(adapter, 'src/auth/middleware.ts');
    insertFile(adapter, 'src/index.ts');

    const result = generateProjectMap(adapter, 'my-project');

    // Header line present
    expect(result).toContain('Project: my-project');

    // auth dir should list file names
    expect(result).toMatch(/src\//);
    // Names without extensions
    expect(result).toContain('login');
    expect(result).toContain('register');
    expect(result).toContain('refresh');
    expect(result).toContain('middleware');
  });

  it('includes Files and Confidence stats in the header', () => {
    insertFile(adapter, 'src/index.ts', { confidence: 'high' });
    insertFile(adapter, 'src/utils.ts', { confidence: 'medium' });
    insertFile(adapter, 'src/skipped.ts', { skippedReason: 'too large' });

    const result = generateProjectMap(adapter, 'my-project');

    // 2 scanned, 1 skipped
    expect(result).toContain('2 scanned, 1 skipped');
    // 1 high / 2 total = 50% high, 1 medium / 2 total = 50% medium
    expect(result).toContain('50% high');
    expect(result).toContain('50% medium');
  });

  // ── 3. Large directory — count only ──────────────────────────────────────────

  it('shows count only when a directory has >8 files', () => {
    for (let i = 1; i <= 10; i++) {
      insertFile(adapter, `src/components/Comp${i}.tsx`);
    }

    const result = generateProjectMap(adapter, 'my-project');

    // Should show "10 files" without listing names
    expect(result).toContain('10 files');
    // Should NOT contain individual file-name lists (no ": Comp1,")
    expect(result).not.toMatch(/files: Comp/);
  });

  // ── 4. Many directories — top 15 + "N more dirs" ─────────────────────────────

  it('shows top 15 dirs and "+ N more dirs" when total dirs >20', () => {
    // Insert files in 22 different directories
    for (let i = 1; i <= 22; i++) {
      insertFile(adapter, `dir${i}/index.ts`);
      insertFile(adapter, `dir${i}/utils.ts`);
    }

    const result = generateProjectMap(adapter, 'big-project');

    // Should mention "+ N more dirs"
    expect(result).toMatch(/\+ \d+ more dirs/);

    // The hidden count should be 22 - 15 = 7
    expect(result).toContain('+ 7 more dirs');
  });

  // ── 5. Token budget — stays under 2000 tokens ────────────────────────────────

  it('stays under 2000 tokens even for a large project', () => {
    // 25 directories × 9 files each = 225 files (>20 dirs triggers top-15 cap)
    for (let d = 1; d <= 25; d++) {
      for (let f = 1; f <= 9; f++) {
        insertFile(adapter, `package${d}/module${f}.ts`);
      }
    }

    const result = generateProjectMap(adapter, 'large-project');
    const tokens = estimateTokens(result);

    expect(tokens).toBeLessThanOrEqual(2000);
  });

  // ── 6. Stack detection ────────────────────────────────────────────────────────

  it('lists TypeScript and Python in the stack line when both languages are present', () => {
    insertFile(adapter, 'src/index.ts', { language: 'typescript' });
    insertFile(adapter, 'scripts/build.py', { language: 'python' });

    const result = generateProjectMap(adapter, 'my-project');

    // First line: "Project: my-project (TypeScript, Python)"
    const firstLine = result.split('\n')[0] ?? '';
    expect(firstLine).toContain('TypeScript');
    expect(firstLine).toContain('Python');
  });

  it('shows only TypeScript when all files are TypeScript', () => {
    insertFile(adapter, 'src/index.ts', { language: 'typescript' });
    insertFile(adapter, 'src/utils.ts', { language: 'typescript' });

    const result = generateProjectMap(adapter, 'ts-project');
    const firstLine = result.split('\n')[0] ?? '';

    expect(firstLine).toContain('TypeScript');
    expect(firstLine).not.toContain('Python');
    expect(firstLine).not.toContain('JavaScript');
  });

  // ── 7. Test directories collapsed to single line ──────────────────────────────

  it('collapses test directories to a single "N files" line without listing names', () => {
    for (let i = 1; i <= 5; i++) {
      insertFile(adapter, `tests/unit${i}.test.ts`, { fileType: 'test' });
    }
    insertFile(adapter, 'src/index.ts');

    const result = generateProjectMap(adapter, 'my-project');

    // Tests dir should appear as "tests/  5 files" — no file names listed
    expect(result).toMatch(/tests\/\s+5 files/);
    // Should NOT contain individual test file names after "files:"
    expect(result).not.toMatch(/files: unit/);
  });

  it('collapses "__tests__" directories to a single line', () => {
    for (let i = 1; i <= 3; i++) {
      insertFile(adapter, `__tests__/file${i}.test.ts`, { fileType: 'test' });
    }
    insertFile(adapter, 'src/app.ts');

    const result = generateProjectMap(adapter, 'my-project');
    expect(result).toMatch(/__tests__\/\s+3 files/);
    expect(result).not.toMatch(/files: file/);
  });

  // ── 8. Header scan stats ───────────────────────────────────────────────────────

  it('includes last scan info from scan_state when available', () => {
    insertFile(adapter, 'src/index.ts');

    const nowSec = Math.floor(Date.now() / 1000);
    setScanState(adapter, 'lastScan', String(nowSec));
    setScanState(adapter, 'lastScanDuration', '42');
    setScanState(adapter, 'lastStrategy', 'git-diff');

    const result = generateProjectMap(adapter, 'my-project');
    const lines = result.split('\n');

    // Third line should contain the scan info
    const scanLine = lines[2] ?? '';
    expect(scanLine).toContain('git-diff');
    expect(scanLine).toContain('42ms');
    // "just now" because we set nowSec to current time
    expect(scanLine).toContain('just now');
  });

  it('shows "never" for last scan when scan_state is empty', () => {
    insertFile(adapter, 'src/index.ts');

    const result = generateProjectMap(adapter, 'my-project');
    const lines = result.split('\n');
    const scanLine = lines[2] ?? '';

    expect(scanLine).toContain('never');
  });

  it('shows 100% high confidence when all files are high confidence', () => {
    insertFile(adapter, 'src/a.ts', { confidence: 'high' });
    insertFile(adapter, 'src/b.ts', { confidence: 'high' });

    const result = generateProjectMap(adapter, 'my-project');
    expect(result).toContain('100% high');
    expect(result).toContain('0% medium');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  it('excludes root-level config files from directory listing', () => {
    insertFile(adapter, 'package.json', { fileType: 'config' });
    insertFile(adapter, 'tsconfig.json', { fileType: 'config' });
    insertFile(adapter, 'src/index.ts');

    const result = generateProjectMap(adapter, 'my-project');

    // Config files should not appear as listed names
    expect(result).not.toContain('package');
    expect(result).not.toContain('tsconfig');
  });

  it('handles exactly 8 files in a directory by listing names (boundary)', () => {
    for (let i = 1; i <= 8; i++) {
      insertFile(adapter, `lib/file${i}.ts`);
    }

    const result = generateProjectMap(adapter, 'my-project');

    // 8 files: should list names (boundary is <=8 → list, >8 → count)
    expect(result).toMatch(/files: file/);
  });

  it('handles exactly 9 files in a directory by showing count only (boundary)', () => {
    for (let i = 1; i <= 9; i++) {
      insertFile(adapter, `lib/file${i}.ts`);
    }

    const result = generateProjectMap(adapter, 'my-project');

    expect(result).toContain('9 files');
    expect(result).not.toMatch(/9 files: file/);
  });

  it('output is a non-empty string for any non-empty DB', () => {
    insertFile(adapter, 'src/main.ts');
    const result = generateProjectMap(adapter, 'test');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('No files scanned yet.');
  });
});
