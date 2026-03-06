import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { DoctorDeps } from '../../src/tools/doctor.js';
import { handleDoctor } from '../../src/tools/doctor.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function healthyDeps(adapter: NodeSqliteAdapter, dir: string): DoctorDeps {
  return {
    nodeVersion: 'v22.0.0',
    backend: 'node:sqlite',
    fts5: true,
    dbPath: join(dir, 'test.db'),
    projectRoot: '/home/user/project',
    projectRootMethod: 'git-root',
    captureLevel: 'metadata',
    logPath: join(dir, 'locus.log'),
    db: adapter,
    checkDbWritable: () => true,
    checkGitAvailable: () => true,
    checkDiskSpaceMb: () => 1000,
    checkLogWritable: () => true,
  };
}

describe('handleDoctor', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-doctor-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. All checks pass with healthy defaults ──────────────────────────────

  it('returns all ok checks with healthy defaults', () => {
    // Seed one file so the Scanner check resolves to 'ok'
    adapter.run(
      `INSERT INTO files (
        relative_path, exports_json, imports_json, re_exports_json,
        file_type, language, lines, confidence_level, confidence_reason,
        last_scanned, skipped_reason
      ) VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', null, ?, null)`,
      ['src/index.ts', Math.floor(Date.now() / 1000)],
    );

    const deps = healthyDeps(adapter, tempDir);
    const report = handleDoctor(deps);

    expect(report.failures).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.passed).toBe(12);
    expect(report.checks).toHaveLength(12);
    for (const check of report.checks) {
      expect(check.status).toBe('ok');
    }
  });

  // ── 2. Node.js version check: ok for >= 22 ────────────────────────────────

  it('marks Node.js ok for version >= 22', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.nodeVersion = 'v22.3.0';
    const report = handleDoctor(deps);

    const nodeCheck = report.checks.find((c) => c.name === 'Node.js');
    expect(nodeCheck?.status).toBe('ok');
    expect(nodeCheck?.message).toContain('v22.3.0');
    expect(nodeCheck?.message).toContain('node:sqlite');
  });

  it('marks Node.js ok for version >= 20 (sql.js fallback note)', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.nodeVersion = 'v20.11.0';
    const report = handleDoctor(deps);

    const nodeCheck = report.checks.find((c) => c.name === 'Node.js');
    expect(nodeCheck?.status).toBe('ok');
    expect(nodeCheck?.message).toContain('v20.11.0');
    expect(nodeCheck?.message).toContain('sql.js fallback');
  });

  it('marks Node.js fail for version < 20', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.nodeVersion = 'v18.19.0';
    const report = handleDoctor(deps);

    const nodeCheck = report.checks.find((c) => c.name === 'Node.js');
    expect(nodeCheck?.status).toBe('fail');
    expect(nodeCheck?.message).toContain('< 20, unsupported');
    expect(nodeCheck?.fix).toContain('Upgrade');
  });

  // ── 3. Storage backend: warn for sql.js ───────────────────────────────────

  it('marks Storage backend warn for sql.js', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.backend = 'sql.js';
    const report = handleDoctor(deps);

    const backendCheck = report.checks.find((c) => c.name === 'Storage backend');
    expect(backendCheck?.status).toBe('warn');
    expect(backendCheck?.message).toContain('sql.js');
    expect(backendCheck?.fix).toContain('Node.js 22+');
  });

  it('marks Storage backend ok for node:sqlite', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.backend = 'node:sqlite';
    const report = handleDoctor(deps);

    const backendCheck = report.checks.find((c) => c.name === 'Storage backend');
    expect(backendCheck?.status).toBe('ok');
    expect(backendCheck?.message).toBe('node:sqlite');
  });

  // ── 4. FTS5: warn when unavailable ───────────────────────────────────────

  it('marks FTS5 warn when unavailable', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.fts5 = false;
    const report = handleDoctor(deps);

    const ftsCheck = report.checks.find((c) => c.name === 'FTS5');
    expect(ftsCheck?.status).toBe('warn');
    expect(ftsCheck?.message).toContain('not available');
    expect(ftsCheck?.fix).toContain('LIKE fallback');
  });

  it('marks FTS5 ok when available', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.fts5 = true;
    const report = handleDoctor(deps);

    const ftsCheck = report.checks.find((c) => c.name === 'FTS5');
    expect(ftsCheck?.status).toBe('ok');
    expect(ftsCheck?.message).toContain('available');
  });

  // ── 5. DB writable: fail when not writable ───────────────────────────────

  it('marks DB writable fail when checkDbWritable returns false', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkDbWritable = () => false;
    const report = handleDoctor(deps);

    const dbCheck = report.checks.find((c) => c.name === 'DB writable');
    expect(dbCheck?.status).toBe('fail');
    expect(dbCheck?.message).toContain('not writable');
    expect(dbCheck?.fix).toContain('permissions');
  });

  it('marks DB writable ok when checkDbWritable returns true', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkDbWritable = () => true;
    const report = handleDoctor(deps);

    const dbCheck = report.checks.find((c) => c.name === 'DB writable');
    expect(dbCheck?.status).toBe('ok');
    expect(dbCheck?.message).toContain(deps.dbPath);
  });

  // ── 6. Capture level: warn for 'full' ────────────────────────────────────

  it("marks Capture level warn for 'full'", () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.captureLevel = 'full';
    const report = handleDoctor(deps);

    const capCheck = report.checks.find((c) => c.name === 'Capture level');
    expect(capCheck?.status).toBe('warn');
    expect(capCheck?.message).toContain('WARNING');
    expect(capCheck?.fix).toContain('metadata');
  });

  // ── 7. Capture level: ok for 'metadata' ──────────────────────────────────

  it("marks Capture level ok for 'metadata'", () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.captureLevel = 'metadata';
    const report = handleDoctor(deps);

    const capCheck = report.checks.find((c) => c.name === 'Capture level');
    expect(capCheck?.status).toBe('ok');
    expect(capCheck?.message).toContain('metadata');
    expect(capCheck?.message).toContain('no raw content');
  });

  it("marks Capture level ok for 'redacted'", () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.captureLevel = 'redacted';
    const report = handleDoctor(deps);

    const capCheck = report.checks.find((c) => c.name === 'Capture level');
    expect(capCheck?.status).toBe('ok');
    expect(capCheck?.message).toContain('redacted');
  });

  // ── 8. Disk space: warn when < 100MB ─────────────────────────────────────

  it('marks Disk space warn when < 100 MB free', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkDiskSpaceMb = () => 50;
    const report = handleDoctor(deps);

    const diskCheck = report.checks.find((c) => c.name === 'Disk space');
    expect(diskCheck?.status).toBe('warn');
    expect(diskCheck?.message).toContain('50 MB');
    expect(diskCheck?.fix).toContain('disk space');
  });

  it('marks Disk space ok when >= 100 MB free', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkDiskSpaceMb = () => 500;
    const report = handleDoctor(deps);

    const diskCheck = report.checks.find((c) => c.name === 'Disk space');
    expect(diskCheck?.status).toBe('ok');
    expect(diskCheck?.message).toContain('500 MB');
  });

  // ── 9. Scanner: warn when no files indexed ────────────────────────────────

  it('marks Scanner warn when no files indexed and no last scan', () => {
    const deps = healthyDeps(adapter, tempDir);
    // DB is empty — no files, no scan_state
    const report = handleDoctor(deps);

    const scanCheck = report.checks.find((c) => c.name === 'Scanner');
    expect(scanCheck?.status).toBe('warn');
    expect(scanCheck?.message).toContain('No scan');
    expect(scanCheck?.fix).toContain('memory_scan');
  });

  it('marks Scanner warn when last scan found no files (scan_state set but files=0)', () => {
    const deps = healthyDeps(adapter, tempDir);
    // Insert a lastScan record without any files
    adapter.run("INSERT INTO scan_state (key, value) VALUES ('lastScan', ?)", [String(Date.now())]);
    const report = handleDoctor(deps);

    const scanCheck = report.checks.find((c) => c.name === 'Scanner');
    expect(scanCheck?.status).toBe('warn');
    expect(scanCheck?.message).toContain('Last scan found no files');
  });

  it('marks Scanner ok when files are indexed', () => {
    const deps = healthyDeps(adapter, tempDir);
    // Insert a file into the DB
    adapter.run(
      `INSERT INTO files (relative_path, exports_json, imports_json, re_exports_json,
        file_type, language, lines, confidence_level, confidence_reason,
        last_scanned, skipped_reason)
       VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', null, ?, null)`,
      ['src/index.ts', Math.floor(Date.now() / 1000)],
    );
    const report = handleDoctor(deps);

    const scanCheck = report.checks.find((c) => c.name === 'Scanner');
    expect(scanCheck?.status).toBe('ok');
    expect(scanCheck?.message).toContain('1 files indexed');
    expect(scanCheck?.message).toContain('0 skipped');
  });

  // ── 10. Report summary counts are correct ────────────────────────────────

  it('report summary counts (passed, warnings, failures) match check statuses', () => {
    const deps = healthyDeps(adapter, tempDir);
    // Induce 1 fail, 1 warn, rest ok
    deps.checkDbWritable = () => false; // fail
    deps.backend = 'sql.js'; // warn
    // nodeVersion v22 = ok, fts5 true = ok, etc.

    const report = handleDoctor(deps);

    const expectedFail = report.checks.filter((c) => c.status === 'fail').length;
    const expectedWarn = report.checks.filter((c) => c.status === 'warn').length;
    const expectedOk = report.checks.filter((c) => c.status === 'ok').length;

    expect(report.failures).toBe(expectedFail);
    expect(report.warnings).toBe(expectedWarn);
    expect(report.passed).toBe(expectedOk);
    expect(report.failures + report.warnings + report.passed).toBe(report.checks.length);
  });

  // ── 11. Project root check ────────────────────────────────────────────────

  it('includes project root path and detection method in check message', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.projectRoot = '/home/user/myproject';
    deps.projectRootMethod = 'project-marker';
    const report = handleDoctor(deps);

    const rootCheck = report.checks.find((c) => c.name === 'Project root');
    expect(rootCheck?.status).toBe('ok');
    expect(rootCheck?.message).toContain('/home/user/myproject');
    expect(rootCheck?.message).toContain('project-marker');
  });

  // ── 12. Git availability warn ─────────────────────────────────────────────

  it('marks Git warn when not available', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkGitAvailable = () => false;
    const report = handleDoctor(deps);

    const gitCheck = report.checks.find((c) => c.name === 'Git');
    expect(gitCheck?.status).toBe('warn');
    expect(gitCheck?.message).toContain('not available');
    expect(gitCheck?.fix).toContain('git');
  });

  // ── 13. Log file not writable ─────────────────────────────────────────────

  it('marks Log file warn when not writable', () => {
    const deps = healthyDeps(adapter, tempDir);
    deps.checkLogWritable = () => false;
    const report = handleDoctor(deps);

    const logCheck = report.checks.find((c) => c.name === 'Log file');
    expect(logCheck?.status).toBe('warn');
    expect(logCheck?.message).toContain('not writable');
    expect(logCheck?.fix).toContain('permissions');
  });
});
