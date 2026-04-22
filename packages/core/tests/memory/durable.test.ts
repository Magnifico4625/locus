import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // Dynamic import workaround for node:sqlite
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'durable-test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('DurableMemoryStore', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-durable-memory-'));
    adapter = createAdapter(tempDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('opens on a freshly migrated database and returns no topic matches', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    const { DurableMemoryStore } = await import('../../src/memory/durable.js');

    runMigrations(adapter, false);

    const store = new DurableMemoryStore(adapter, false);
    expect(store.listByTopic('database_choice')).toEqual([]);
  });

  it('searches an empty durable store without returning legacy memories', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    const { DurableMemoryStore } = await import('../../src/memory/durable.js');

    runMigrations(adapter, true);

    const store = new DurableMemoryStore(adapter, true);
    expect(store.search('postgres')).toEqual([]);
  });
});
