import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // Dynamic import workaround for node:sqlite
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('runMigrations', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-migrations-'));
    adapter = createAdapter(tempDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates schema_version table with version 1', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const row = adapter.get<{ version: number }>('SELECT version FROM schema_version');
    expect(row?.version).toBe(1);
  });

  it('creates files table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'files')).toBe(true);
  });

  it('creates memories table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'memories')).toBe(true);
  });

  it('creates hook_captures table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'hook_captures')).toBe(true);
  });

  it('creates scan_state table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'scan_state')).toBe(true);
  });

  it('creates memories_fts virtual table when fts5=true', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, true);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'memories_fts')).toBe(true);
  });

  it('does NOT create memories_fts when fts5=false', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'memories_fts')).toBe(false);
  });

  it('is idempotent (running twice does not error)', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    expect(() => runMigrations(adapter, false)).not.toThrow();
    const row = adapter.get<{ version: number }>('SELECT version FROM schema_version');
    expect(row?.version).toBe(1);
  });

  it('files table has expected columns', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const columns = adapter.all<{ name: string }>("PRAGMA table_info('files')");
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('relative_path');
    expect(colNames).toContain('exports_json');
    expect(colNames).toContain('imports_json');
    expect(colNames).toContain('re_exports_json');
    expect(colNames).toContain('file_type');
    expect(colNames).toContain('language');
    expect(colNames).toContain('lines');
    expect(colNames).toContain('confidence_level');
    expect(colNames).toContain('confidence_reason');
    expect(colNames).toContain('last_scanned');
    expect(colNames).toContain('skipped_reason');
  });

  it('memories table has expected columns', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const columns = adapter.all<{ name: string }>("PRAGMA table_info('memories')");
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('layer');
    expect(colNames).toContain('content');
    expect(colNames).toContain('tags_json');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain('session_id');
  });

  it('memories table has indexes on layer and session_id', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const indexes = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'",
    );
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames.some((n) => n.includes('layer'))).toBe(true);
    expect(indexNames.some((n) => n.includes('session'))).toBe(true);
  });
});
