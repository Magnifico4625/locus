import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('detectFts5', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-init-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true when FTS5 is available', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { NodeSqliteAdapter } = await import('../../src/storage/node-sqlite.js');
    const { detectFts5 } = await import('../../src/storage/init.js');
    const raw = new DatabaseSync(join(tempDir, 'fts5test.db'));
    const adapter = new NodeSqliteAdapter(raw);
    const result = detectFts5(adapter);
    expect(result).toBe(true);
    adapter.close();
  });

  it('returns false when FTS5 is unavailable', async () => {
    const { detectFts5 } = await import('../../src/storage/init.js');
    // Create a mock adapter that throws on FTS5 creation
    const mockAdapter = {
      exec(sql: string): void {
        if (sql.includes('fts5')) {
          throw new Error('unknown module: fts5');
        }
      },
      run(): { changes: number; lastInsertRowid: number } {
        return { changes: 0, lastInsertRowid: 0 };
      },
      get<T>(): T | undefined {
        return undefined;
      },
      all<T>(): T[] {
        return [];
      },
      close(): void {},
    };
    const result = detectFts5(mockAdapter);
    expect(result).toBe(false);
  });
});

describe('initStorage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-init-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a working StorageInit object', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const dbPath = join(tempDir, 'test.db');
    const result = await initStorage(dbPath);

    expect(result.db).toBeDefined();
    expect(result.backend).toBe('node:sqlite');
    expect(typeof result.fts5).toBe('boolean');
    result.db.close();
  });

  it('creates a database that has migrations applied', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const dbPath = join(tempDir, 'test.db');
    const result = await initStorage(dbPath);

    // Verify migrations ran by checking for tables
    const tables = result.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('schema_version');
    expect(tableNames).toContain('files');
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('hook_captures');
    expect(tableNames).toContain('scan_state');

    result.db.close();
  });

  it('detects FTS5 availability on Node 25+', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const dbPath = join(tempDir, 'test.db');
    const result = await initStorage(dbPath);
    // Node 25 should have FTS5
    expect(result.fts5).toBe(true);
    result.db.close();
  });

  it('creates memories_fts table when FTS5 is available', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const dbPath = join(tempDir, 'test.db');
    const result = await initStorage(dbPath);

    if (result.fts5) {
      const tables = result.db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      expect(tables.some((t) => t.name === 'memories_fts')).toBe(true);
    }
    result.db.close();
  });

  it('adapter can insert and query data', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const dbPath = join(tempDir, 'test.db');
    const result = await initStorage(dbPath);

    // Insert into memories table
    const now = Date.now();
    result.db.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', 'test decision', '["test"]', now, now],
    );

    const row = result.db.get<{ content: string }>('SELECT content FROM memories WHERE layer = ?', [
      'semantic',
    ]);
    expect(row?.content).toBe('test decision');

    result.db.close();
  });

  it('creates parent directory if it does not exist', async () => {
    const { initStorage } = await import('../../src/storage/init.js');
    const nestedDir = join(tempDir, 'nested', 'deep');
    const dbPath = join(nestedDir, 'test.db');
    const result = await initStorage(dbPath);
    expect(result.db).toBeDefined();
    result.db.close();
  });
});
