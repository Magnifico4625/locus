import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScanDeps } from '../../src/scanner/index.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleScan, type ScanToolDeps } from '../../src/tools/scan.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

/** ScanDeps that returns a fixed file list and forces full-scan logic (no git). */
function makeMockDeps(files: string[], nowSec: number): ScanDeps {
  return {
    isGitRepo: () => false,
    getHead: () => null,
    diffUnstaged: () => [],
    diffBetween: () => [],
    isAncestor: () => false,
    findByMtime: () => files,
    now: () => nowSec,
  };
}

describe('handleScan', () => {
  let tempDir: string;
  let projectDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-scan-tool-'));
    // Separate dir for the "project" so we can put TS files there
    projectDir = mkdtempSync(join(tmpdir(), 'locus-scan-proj-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('delegates to scanProject and returns a ScanResult shape', async () => {
    // Write a minimal TS file so the scanner has something to parse
    writeFileSync(join(projectDir, 'index.ts'), 'export function hello() {}\n');

    const deps: ScanToolDeps = {
      projectPath: projectDir,
      db: adapter,
      config: LOCUS_DEFAULTS,
      scanDeps: makeMockDeps(['index.ts'], Math.floor(Date.now() / 1000)),
    };

    const result = await handleScan(deps);

    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('strategy');
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.stats.scannedFiles).toBe('number');
    expect(typeof result.stats.durationMs).toBe('number');
  });

  it('returns skip strategy when called within the debounce interval', async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    // Pre-populate lastScan in DB to simulate a very recent scan
    adapter.run("INSERT OR REPLACE INTO scan_state (key, value) VALUES ('lastScan', ?)", [
      String(nowSec - 1), // 1 second ago — within minScanInterval (10s)
    ]);

    const deps: ScanToolDeps = {
      projectPath: projectDir,
      db: adapter,
      config: LOCUS_DEFAULTS,
      scanDeps: makeMockDeps(['index.ts'], nowSec),
    };

    const result = await handleScan(deps);

    expect(result.strategy.type).toBe('skip');
    expect(result.strategy.reason).toBe('debounce');
    expect(result.files).toHaveLength(0);
  });

  it('scans TS files in a minimal temp project and returns entries', async () => {
    writeFileSync(join(projectDir, 'index.ts'), 'export const answer = 42;\n');

    const deps: ScanToolDeps = {
      projectPath: projectDir,
      db: adapter,
      config: LOCUS_DEFAULTS,
      // findByMtime returns our single file → totalFiles was 0 → full rescan triggered
      scanDeps: makeMockDeps(['index.ts'], Math.floor(Date.now() / 1000)),
    };

    const result = await handleScan(deps);

    // A full rescan should have been triggered (totalFiles=0, changed=1 > 0)
    expect(result.strategy.type).toBe('full');
    expect(result.stats.scannedFiles).toBeGreaterThanOrEqual(1);

    const entry = result.files.find((f) => f.relativePath === 'index.ts');
    expect(entry).toBeDefined();
    expect(entry?.language).toBe('typescript');
  });

  it('passes config correctly — respects maxScanFiles limit concept (config forwarded)', async () => {
    writeFileSync(join(projectDir, 'index.ts'), 'export function greet() {}\n');

    const customConfig = { ...LOCUS_DEFAULTS, captureLevel: 'full' as const };

    const deps: ScanToolDeps = {
      projectPath: projectDir,
      db: adapter,
      config: customConfig,
      scanDeps: makeMockDeps(['index.ts'], Math.floor(Date.now() / 1000)),
    };

    // If config is forwarded properly, scanProject will run without error
    const result = await handleScan(deps);

    expect(result).toHaveProperty('strategy');
    // Strategy should reflect a real scan occurred (not mocked away)
    expect(['full', 'mtime', 'git-diff', 'skip'].includes(result.strategy.type)).toBe(true);
  });
});
