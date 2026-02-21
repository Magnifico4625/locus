import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ScanDeps, scanProject } from '../../src/scanner/index.js';
import { initStorage } from '../../src/storage/init.js';
import { type DatabaseAdapter, LOCUS_DEFAULTS } from '../../src/types.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'sample-project');

// ScanDeps that forces a full scan (no git, mtime returns files to trigger full rescan)
function fullScanDeps(): ScanDeps {
  return {
    isGitRepo: () => false,
    getHead: () => null,
    diffUnstaged: () => [],
    diffBetween: () => [],
    isAncestor: () => false,
    // Return enough files so shouldFullRescan triggers (totalFiles=0, changed>0 → full)
    findByMtime: () => [
      'src/index.ts',
      'src/auth/login.ts',
      'src/utils/helpers.ts',
      '.env',
      'package.json',
      'tsconfig.json',
      'node_modules/.keep',
    ],
    now: () => Math.floor(Date.now() / 1000),
  };
}

describe('scanProject', () => {
  let tempDir: string;
  let db: DatabaseAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-scan-'));
    const storage = await initStorage(join(tempDir, 'test.db'));
    db = storage.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scans the fixture project and returns correct file count', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    // Should scan 3 TS files: src/index.ts, src/auth/login.ts, src/utils/helpers.ts
    expect(result.stats.scannedFiles).toBe(3);
    // Should skip: .env (denylisted), node_modules/.keep (ignored),
    // package.json (no lang), tsconfig.json (no lang)
    expect(result.stats.skippedFiles).toBeGreaterThanOrEqual(2);
  });

  it('parses exports correctly for login.ts', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const login = result.files.find((f) => f.relativePath === 'src/auth/login.ts');
    expect(login).toBeDefined();
    expect(login?.exports).toHaveLength(1);
    expect(login?.exports[0]?.name).toBe('loginUser');
    expect(login?.exports[0]?.kind).toBe('function');
  });

  it('parses exports correctly for helpers.ts', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const helpers = result.files.find((f) => f.relativePath === 'src/utils/helpers.ts');
    expect(helpers).toBeDefined();
    expect(helpers?.exports).toHaveLength(1);
    expect(helpers?.exports[0]?.name).toBe('formatDate');
    expect(helpers?.exports[0]?.kind).toBe('const');
  });

  it('detects barrel file with medium:barrel confidence', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const barrel = result.files.find((f) => f.relativePath === 'src/index.ts');
    expect(barrel).toBeDefined();
    expect(barrel?.fileType).toBe('barrel');
    expect(barrel?.confidence.level).toBe('medium');
    expect(barrel?.confidence.reason).toBe('barrel');
    expect(barrel?.reExports).toHaveLength(1);
  });

  it('parses imports correctly for login.ts', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const login = result.files.find((f) => f.relativePath === 'src/auth/login.ts');
    expect(login).toBeDefined();
    expect(login?.imports.length).toBeGreaterThanOrEqual(1);
    const prismaImport = login?.imports.find((i) => i.source === '@prisma/client');
    expect(prismaImport).toBeDefined();
    expect(prismaImport?.isTypeOnly).toBe(false);
  });

  it('populates ScanStats correctly', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    expect(result.stats.scannedFiles).toBe(3);
    expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.highConfidence + result.stats.mediumConfidence).toBe(3);
  });

  it('stores file entries in the database', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const rows = db.all<{ relative_path: string }>(
      'SELECT relative_path FROM files WHERE skipped_reason IS NULL ORDER BY relative_path',
    );
    const paths = rows.map((r) => r.relative_path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/auth/login.ts');
    expect(paths).toContain('src/utils/helpers.ts');
    expect(paths).toHaveLength(3);
  });

  it('updates scan_state after scanning', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const lastScan = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastScan'",
    );
    expect(lastScan).toBeDefined();
    expect(Number(lastScan?.value)).toBeGreaterThan(0);

    // Full scan should also update lastFullRescan
    const lastFull = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastFullRescan'",
    );
    expect(lastFull).toBeDefined();
    expect(Number(lastFull?.value)).toBeGreaterThan(0);
  });

  it('returns strategy type full for first scan', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    expect(result.strategy.type).toBe('full');
  });

  it('skips denylisted .env file', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const envFile = result.files.find((f) => f.relativePath === '.env');
    expect(envFile).toBeUndefined();
  });

  it('skips node_modules files', async () => {
    const config = { ...LOCUS_DEFAULTS };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const nmFile = result.files.find((f) => f.relativePath.includes('node_modules'));
    expect(nmFile).toBeUndefined();
  });

  it('writes lastStrategy and lastScanDuration to scan_state', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const strategyRow = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastStrategy'",
    );
    expect(strategyRow).toBeDefined();
    expect(strategyRow?.value).toBe('full');

    const durationRow = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastScanDuration'",
    );
    expect(durationRow).toBeDefined();
    expect(Number(durationRow?.value)).toBeGreaterThanOrEqual(0);
  });

  it('stops scanning after reaching maxScanFiles limit', async () => {
    const config = { ...LOCUS_DEFAULTS, maxScanFiles: 1 };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    // Only 1 file should be scanned (maxScanFiles=1)
    expect(result.stats.scannedFiles).toBe(1);
    // Remaining scannable files should count as skipped
    expect(result.stats.skippedFiles).toBeGreaterThanOrEqual(1);
  });

  it('stores skipped entries with skippedReason in the database', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    // The fixture has .env (ignored — shouldIgnore fires before isDenylisted)
    // and package.json/tsconfig.json (unknown-language)
    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      'SELECT relative_path, skipped_reason FROM files WHERE skipped_reason IS NOT NULL',
    );
    expect(skippedRows.length).toBeGreaterThanOrEqual(1);

    // .env is in HARDCODED_IGNORE so shouldIgnore fires first → reason 'ignored'
    const envRow = skippedRows.find((r) => r.relative_path === '.env');
    expect(envRow).toBeDefined();
    expect(envRow?.skipped_reason).toBe('ignored');
  });

  it('stores unknown-language skip reason for non-code files', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      'SELECT relative_path, skipped_reason FROM files WHERE skipped_reason IS NOT NULL',
    );

    // package.json has no known language
    const pkgRow = skippedRows.find((r) => r.relative_path === 'package.json');
    expect(pkgRow).toBeDefined();
    expect(pkgRow?.skipped_reason).toBe('unknown-language');
  });

  it('stores max-files-reached skip reason when limit hit', async () => {
    const config = { ...LOCUS_DEFAULTS, maxScanFiles: 1 };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      "SELECT relative_path, skipped_reason FROM files WHERE skipped_reason = 'max-files-reached'",
    );
    expect(skippedRows.length).toBeGreaterThanOrEqual(1);
  });
});
