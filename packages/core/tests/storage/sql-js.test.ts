import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let hasSqlJs = false;
try {
  await import('sql.js');
  hasSqlJs = true;
} catch {}

describe.skipIf(!hasSqlJs)('SqlJsAdapter', () => {
  let tempDir: string;
  let dbPath: string;
  let adapter: InstanceType<typeof import('../../src/storage/sql-js.js').SqlJsAdapter>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-sqljs-'));
    dbPath = join(tempDir, 'test.db');
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const { SqlJsAdapter } = await import('../../src/storage/sql-js.js');
    adapter = new SqlJsAdapter(db, dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exec creates table', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const result = adapter.all<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table"',
    );
    expect(result.some((r) => r.name === 'test')).toBe(true);
  });

  it('run inserts and returns changes', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    const result = adapter.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1);
  });

  it('run returns correct lastInsertRowid for multiple inserts', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['a']);
    const result = adapter.run('INSERT INTO test (val) VALUES (?)', ['b']);
    expect(result.lastInsertRowid).toBe(2);
  });

  it('get returns single row', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    const row = adapter.get<{ val: string }>('SELECT val FROM test WHERE id = ?', [1]);
    expect(row?.val).toBe('hello');
  });

  it('get returns undefined for no match', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    const row = adapter.get('SELECT * FROM test WHERE id = ?', [999]);
    expect(row).toBeUndefined();
  });

  it('all returns multiple rows', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['a']);
    adapter.run('INSERT INTO test (val) VALUES (?)', ['b']);
    const rows = adapter.all<{ val: string }>('SELECT val FROM test ORDER BY id');
    expect(rows).toEqual([{ val: 'a' }, { val: 'b' }]);
  });

  it('all returns empty array for no results', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    const rows = adapter.all('SELECT * FROM test');
    expect(rows).toEqual([]);
  });

  it('saves to disk on close', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['persisted']);
    adapter.close();
    expect(existsSync(dbPath)).toBe(true);
    const fileData = readFileSync(dbPath);
    expect(fileData.length).toBeGreaterThan(0);
  });

  it('loads existing database from disk', async () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['persisted']);
    adapter.close();

    // Reopen from saved file
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const fileData = readFileSync(dbPath);
    const db = new SQL.Database(fileData);
    const { SqlJsAdapter } = await import('../../src/storage/sql-js.js');
    const adapter2 = new SqlJsAdapter(db, dbPath);

    const row = adapter2.get<{ val: string }>('SELECT val FROM test WHERE id = 1');
    expect(row?.val).toBe('persisted');
    adapter2.close();
  });

  it('debounced save schedules timer', () => {
    vi.useFakeTimers();
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['timer']);
    // File should not exist yet (debounce not fired)
    expect(existsSync(dbPath)).toBe(false);
    // Advance timer by 5s
    vi.advanceTimersByTime(5000);
    expect(existsSync(dbPath)).toBe(true);
    vi.useRealTimers();
  });

  it('run with no params works', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT DEFAULT "x")');
    const result = adapter.run('INSERT INTO test DEFAULT VALUES');
    expect(result.changes).toBe(1);
  });
});
