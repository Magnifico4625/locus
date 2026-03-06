/**
 * Tests the ensureFts() fix for the migration gap scenario:
 * DB was first created when FTS5 was unavailable (V1 with fts5=false),
 * then later opened when FTS5 IS available (V2 with fts5=true).
 * ensureFts() should auto-create missing FTS tables and rebuild the index.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

// biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
const sqlite = require('node:sqlite') as any;

function openDb(dir: string): NodeSqliteAdapter {
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA busy_timeout = 5000');
  return new NodeSqliteAdapter(raw);
}

describe('ensureFts: migration gap recovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-mixed-fts-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('auto-creates memories_fts and rebuilds index when V1 ran without FTS5', () => {
    // Step 1: Simulate an older DB where only V1 has run (pre-v3.0) without FTS
    {
      const adapter = openDb(tempDir);

      // Manually create V1 schema without FTS
      adapter.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
      adapter.exec(`CREATE TABLE IF NOT EXISTS files (
        relative_path TEXT PRIMARY KEY,
        exports_json TEXT, imports_json TEXT, re_exports_json TEXT,
        file_type TEXT, language TEXT, lines INTEGER,
        confidence_level TEXT, confidence_reason TEXT,
        last_scanned INTEGER, skipped_reason TEXT
      )`);
      adapter.exec(`CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL, content TEXT NOT NULL,
        tags_json TEXT, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, session_id TEXT
      )`);
      adapter.exec('CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer)');
      adapter.exec(`CREATE TABLE IF NOT EXISTS hook_captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT, file_paths_json TEXT, status TEXT,
        exit_code INTEGER, timestamp INTEGER, duration_ms INTEGER,
        diff_added INTEGER, diff_removed INTEGER,
        error_kind TEXT, bash_command TEXT
      )`);
      adapter.exec('CREATE TABLE IF NOT EXISTS scan_state (key TEXT PRIMARY KEY, value TEXT)');
      adapter.run('INSERT INTO schema_version (version) VALUES (?)', [1]);

      // Add memories without FTS indexing
      const mem = new SemanticMemory(adapter, false);
      mem.add('Architecture: use monorepo pattern', ['architecture']);
      mem.add('Bot: state machine for commands', ['bot']);
      mem.add('Use Zod for all validations', ['zod']);

      adapter.close();
    }

    // Step 2: Upgrade - runMigrations with fts5=true triggers ensureFts()
    {
      const adapter = openDb(tempDir);
      runMigrations(adapter, true);

      // Both FTS tables should now exist (ensureFts auto-created them)
      const tables = adapter.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'",
      );
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('memories_fts');
      expect(tableNames).toContain('conversation_fts');

      // FTS index should be populated from existing memories
      const ftsCount = adapter.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM memories_fts',
      );
      expect(ftsCount?.cnt).toBe(3);

      // Search should now work
      const mem = new SemanticMemory(adapter, true);
      expect(mem.count()).toBe(3);

      const archResults = mem.search('architecture');
      expect(archResults).toHaveLength(1);
      expect(archResults[0]?.content).toContain('Architecture');

      const botResults = mem.search('bot');
      expect(botResults).toHaveLength(1);

      const zodResults = mem.search('Zod');
      expect(zodResults).toHaveLength(1);

      // New adds should also work
      mem.add('New entry after FTS repair', []);
      const newResults = mem.search('repair');
      expect(newResults).toHaveLength(1);

      adapter.close();
    }
  });

  it('auto-rebuilds empty memories_fts when table exists but has no data', () => {
    // Create DB with FTS5 tables but empty FTS index
    {
      const adapter = openDb(tempDir);
      runMigrations(adapter, true);

      // Insert directly into memories (bypassing FTS indexing)
      adapter.run(
        'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ['semantic', 'Orphaned memory: never indexed', '[]', Date.now(), Date.now()],
      );

      adapter.close();
    }

    // Reopen - ensureFts should detect empty FTS and rebuild
    {
      const adapter = openDb(tempDir);
      runMigrations(adapter, true);

      const mem = new SemanticMemory(adapter, true);
      const results = mem.search('orphaned');
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toContain('Orphaned memory');

      adapter.close();
    }
  });

  it('FTS5 always true: both tables exist and work', () => {
    const adapter = openDb(tempDir);
    runMigrations(adapter, true);

    const tables = adapter.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'",
    );
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('memories_fts');
    expect(tableNames).toContain('conversation_fts');

    const mem = new SemanticMemory(adapter, true);
    mem.add('Test entry', ['test']);
    const results = mem.search('Test');
    expect(results).toHaveLength(1);

    adapter.close();
  });
});
