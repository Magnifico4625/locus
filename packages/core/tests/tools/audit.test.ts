import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { AuditDeps } from '../../src/tools/audit.js';
import { handleAudit } from '../../src/tools/audit.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function makeAuditDeps(adapter: NodeSqliteAdapter, dir: string): AuditDeps {
  const dbPath = join(dir, 'test.db');
  const logPath = join(dir, 'locus.log');
  return {
    db: adapter,
    projectPath: '/home/user/myproject',
    dbPath,
    logPath,
    captureLevel: 'metadata',
  };
}

function insertFile(
  adapter: NodeSqliteAdapter,
  path: string,
  exportsJson = '[]',
  importsJson = '[]',
  skippedReason: string | null = null,
): void {
  adapter.run(
    `INSERT INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, ?, ?, '[]', 'module', 'typescript', 10, 'high', null, ?, ?)`,
    [path, exportsJson, importsJson, Math.floor(Date.now() / 1000), skippedReason],
  );
}

function insertMemory(
  adapter: NodeSqliteAdapter,
  layer: 'semantic' | 'episodic',
  content: string,
  sessionId: string | null = null,
): void {
  const now = Date.now();
  adapter.run(
    `INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id)
     VALUES (?, ?, '[]', ?, ?, ?)`,
    [layer, content, now, now, sessionId],
  );
}

function insertHookCapture(adapter: NodeSqliteAdapter): void {
  const now = Date.now();
  adapter.run(
    `INSERT INTO hook_captures (tool_name, file_paths_json, status, timestamp, duration_ms)
     VALUES (?, '[]', 'success', ?, ?)`,
    ['Bash', now, 100],
  );
}

describe('handleAudit', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-audit-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Returns formatted string with project path header ─────────────────

  it('returns formatted string containing the project path header', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('Locus Memory Audit — /home/user/myproject');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes capture level in the output', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('Capture level:');
    expect(result).toContain('metadata');
  });

  // ── 2. Shows correct file count ──────────────────────────────────────────

  it('shows 0 file count when DB is empty', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('0 files');
  });

  it('shows correct file count after inserting files', () => {
    insertFile(adapter, 'src/index.ts');
    insertFile(adapter, 'src/utils.ts');
    insertFile(adapter, 'src/api.ts');
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('3 files');
  });

  it('shows correct export count summed from all files', () => {
    insertFile(
      adapter,
      'src/index.ts',
      JSON.stringify([
        { name: 'foo', kind: 'function', isDefault: false, isTypeOnly: false },
        { name: 'bar', kind: 'const', isDefault: false, isTypeOnly: false },
      ]),
    );
    insertFile(
      adapter,
      'src/utils.ts',
      JSON.stringify([{ name: 'helper', kind: 'function', isDefault: false, isTypeOnly: false }]),
    );
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('2 files');
    expect(result).toContain('3 exports');
  });

  it('shows correct import count summed from all files', () => {
    insertFile(
      adapter,
      'src/index.ts',
      '[]',
      JSON.stringify([
        { source: 'react', isTypeOnly: false, isDynamic: false },
        { source: 'lodash', isTypeOnly: false, isDynamic: false },
      ]),
    );
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('2 imports');
  });

  // ── 3. Shows correct semantic memory count and token estimate ────────────

  it('shows 0 semantic entries when none inserted', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('Semantic memory:');
    expect(result).toContain('0 entries');
  });

  it('shows correct semantic count after inserting memories', () => {
    insertMemory(adapter, 'semantic', 'Use Zod for validation');
    insertMemory(adapter, 'semantic', 'Prefer immutability');
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('2 entries');
  });

  it('shows a positive token estimate for semantic memory', () => {
    insertMemory(adapter, 'semantic', 'This is a fairly long piece of text for token counting.');
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    // Token estimate = ceil(content.length / 4) > 0
    expect(result).toMatch(/Semantic memory:\s+\d+ entry.*\((\d+) tokens est\.\)/);
    const match = result.match(/Semantic memory:\s+\d+ entry.*\((\d+) tokens est\.\)/);
    const tokens = Number.parseInt(match?.[1] ?? '0', 10);
    expect(tokens).toBeGreaterThan(0);
  });

  // ── 4. Shows correct episodic memory count with session count ────────────

  it('shows 0 episodic entries and 0 sessions when none inserted', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('Episodic memory:');
    expect(result).toContain('0 entries');
    expect(result).toContain('0 sessions');
  });

  it('shows correct episodic count and distinct session count', () => {
    insertMemory(adapter, 'episodic', 'Session A event 1', 'session-a');
    insertMemory(adapter, 'episodic', 'Session A event 2', 'session-a');
    insertMemory(adapter, 'episodic', 'Session B event 1', 'session-b');
    insertMemory(adapter, 'episodic', 'Session B event 2', 'session-b');
    insertMemory(adapter, 'episodic', 'Session C event 1', 'session-c');

    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('5 entries');
    expect(result).toContain('3 sessions');
  });

  it('shows hook captures count', () => {
    insertHookCapture(adapter);
    insertHookCapture(adapter);
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('2 events');
  });

  // ── 5. Shows correct DB size ─────────────────────────────────────────────

  it('shows DB size in the output', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('DB size:');
    expect(result).toContain(deps.dbPath);
    // Size unit: B, KB, or MB
    expect(result).toMatch(/DB size:\s+\d+(\.\d+)?\s*(B|KB|MB)/);
  });

  it('shows log size as 0 B when log file does not exist', () => {
    const deps = makeAuditDeps(adapter, tempDir);
    // logPath points to a non-existent file
    deps.logPath = join(tempDir, 'nonexistent.log');
    const result = handleAudit(deps);

    expect(result).toContain('Log size: 0 B');
  });

  it('shows non-zero log size when log file exists', () => {
    const logPath = join(tempDir, 'locus.log');
    writeFileSync(logPath, 'some log content here\n');
    const deps = makeAuditDeps(adapter, tempDir);
    deps.logPath = logPath;
    const result = handleAudit(deps);

    expect(result).toContain('Log size:');
    expect(result).toMatch(/Log size:\s+\d+(\.\d+)?\s*(B|KB|MB)/);
    // Should NOT be 0 B
    expect(result).not.toContain('Log size: 0 B');
  });

  // ── 6. Shows capture level info ──────────────────────────────────────────

  it("shows metadata capture level description for 'metadata'", () => {
    const deps = makeAuditDeps(adapter, tempDir);
    deps.captureLevel = 'metadata';
    const result = handleAudit(deps);

    expect(result).toContain("Capture level is 'metadata'");
    expect(result).toContain('no raw file content');
  });

  it("shows redacted capture level description for 'redacted'", () => {
    const deps = makeAuditDeps(adapter, tempDir);
    deps.captureLevel = 'redacted';
    const result = handleAudit(deps);

    expect(result).toContain("'redacted'");
  });

  it("shows warning for 'full' capture level", () => {
    const deps = makeAuditDeps(adapter, tempDir);
    deps.captureLevel = 'full';
    const result = handleAudit(deps);

    expect(result).toContain('WARNING');
    expect(result).toContain("'full'");
  });

  // ── 7. Secrets detection ─────────────────────────────────────────────────

  it('reports no secrets detected when memory content is clean', () => {
    insertMemory(adapter, 'semantic', 'Use composition over inheritance');
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('No secrets detected');
  });

  it('reports secrets found when memory content contains an API key pattern', () => {
    // Insert a memory that triggers the redact() function
    insertMemory(adapter, 'semantic', 'API_KEY=sk-abcdefghijklmnopqrstuv1234567890');
    const deps = makeAuditDeps(adapter, tempDir);
    const result = handleAudit(deps);

    expect(result).toContain('WARNING');
    expect(result).not.toContain('No secrets detected');
  });
});
