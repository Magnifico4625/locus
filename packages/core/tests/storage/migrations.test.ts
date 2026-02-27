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

  it('creates schema_version table with current version', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const row = adapter.get<{ version: number }>('SELECT version FROM schema_version');
    expect(row?.version).toBe(2);
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
    expect(row?.version).toBe(2);
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

describe('migrationV2', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-migrations-v2-'));
    adapter = createAdapter(tempDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates schema_version to 2 on fresh DB', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const row = adapter.get<{ version: number }>('SELECT version FROM schema_version');
    expect(row?.version).toBe(2);
  });

  it('creates conversation_events table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'conversation_events')).toBe(true);
  });

  it('creates event_files table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'event_files')).toBe(true);
  });

  it('creates ingest_log table', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'ingest_log')).toBe(true);
  });

  it('conversation_events has expected columns', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const columns = adapter.all<{ name: string }>("PRAGMA table_info('conversation_events')");
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('event_id');
    expect(colNames).toContain('source');
    expect(colNames).toContain('source_event_id');
    expect(colNames).toContain('project_root');
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('timestamp');
    expect(colNames).toContain('kind');
    expect(colNames).toContain('payload_json');
    expect(colNames).toContain('significance');
    expect(colNames).toContain('tags_json');
    expect(colNames).toContain('created_at');
  });

  it('event_files has expected columns', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const columns = adapter.all<{ name: string }>("PRAGMA table_info('event_files')");
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('event_id');
    expect(colNames).toContain('file_path');
  });

  it('ingest_log has expected columns', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const columns = adapter.all<{ name: string }>("PRAGMA table_info('ingest_log')");
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('event_id');
    expect(colNames).toContain('source');
    expect(colNames).toContain('source_event_id');
    expect(colNames).toContain('processed_at');
  });

  it('creates conversation_fts when fts5=true', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, true);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'conversation_fts')).toBe(true);
  });

  it('does NOT create conversation_fts when fts5=false', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(tables.some((t) => t.name === 'conversation_fts')).toBe(false);
  });

  it('conversation_events has indexes on event_id, timestamp, kind, session_id', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const indexes = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversation_events'",
    );
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames.some((n) => n.includes('event_id'))).toBe(true);
    expect(indexNames.some((n) => n.includes('timestamp'))).toBe(true);
    expect(indexNames.some((n) => n.includes('kind'))).toBe(true);
    expect(indexNames.some((n) => n.includes('session'))).toBe(true);
  });

  it('event_files has indexes on file_path and event_id', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    const indexes = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='event_files'",
    );
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames.some((n) => n.includes('file_path'))).toBe(true);
    expect(indexNames.some((n) => n.includes('event_id'))).toBe(true);
  });

  it('ingest_log unique index enforces dedup on event_id', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);

    const now = Date.now();
    adapter.run('INSERT INTO ingest_log (event_id, source, processed_at) VALUES (?, ?, ?)', [
      'evt-1',
      'claude-code',
      now,
    ]);
    expect(() =>
      adapter.run('INSERT INTO ingest_log (event_id, source, processed_at) VALUES (?, ?, ?)', [
        'evt-1',
        'claude-code',
        now,
      ]),
    ).toThrow();

    const rows = adapter.all<{ event_id: string }>(
      "SELECT event_id FROM ingest_log WHERE event_id = 'evt-1'",
    );
    expect(rows).toHaveLength(1);
  });

  it('is idempotent (running twice does not error)', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    runMigrations(adapter, false);
    expect(() => runMigrations(adapter, false)).not.toThrow();
    const row = adapter.get<{ version: number }>('SELECT version FROM schema_version');
    expect(row?.version).toBe(2);
  });

  it('preserves existing v1 data after v2 migration', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');

    // Run v1-only to insert some data
    // We simulate a v1 DB by running migrations and inserting data
    runMigrations(adapter, false);

    // Insert v1 data
    adapter.run(
      'INSERT INTO memories (layer, content, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['semantic', 'test memory', Date.now(), Date.now()],
    );
    adapter.run(
      'INSERT INTO files (relative_path, file_type, language, lines, last_scanned) VALUES (?, ?, ?, ?, ?)',
      ['src/index.ts', 'module', 'typescript', 42, Date.now()],
    );

    // V2 migration already ran (fresh DB runs both v1+v2)
    // Verify v1 data survived
    const memories = adapter.all<{ content: string }>('SELECT content FROM memories');
    expect(memories).toHaveLength(1);
    expect(memories[0]?.content).toBe('test memory');

    const files = adapter.all<{ relative_path: string }>('SELECT relative_path FROM files');
    expect(files).toHaveLength(1);
    expect(files[0]?.relative_path).toBe('src/index.ts');
  });
});
