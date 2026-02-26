import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let hasNodeSqlite = false;
try {
  await import('node:sqlite');
  hasNodeSqlite = true;
} catch {}

describe.skipIf(!hasNodeSqlite)('NodeSqliteAdapter', () => {
  let tempDir: string;
  let adapter: InstanceType<typeof import('../../src/storage/node-sqlite.js').NodeSqliteAdapter>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-db-'));
    const { DatabaseSync } = await import('node:sqlite');
    const { NodeSqliteAdapter } = await import('../../src/storage/node-sqlite.js');
    const raw = new DatabaseSync(join(tempDir, 'test.db'));
    adapter = new NodeSqliteAdapter(raw);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exec creates table', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const result = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
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

  it('run with no params works', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT DEFAULT "x")');
    const result = adapter.run('INSERT INTO test DEFAULT VALUES');
    expect(result.changes).toBe(1);
  });
});
