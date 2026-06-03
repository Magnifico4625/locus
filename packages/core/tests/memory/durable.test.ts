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

  it('stores normalized project roots and scopes topic lookups', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    const { DurableMemoryStore } = await import('../../src/memory/durable.js');

    runMigrations(adapter, false);

    const store = new DurableMemoryStore(adapter, false);
    const locus = store.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      summary: 'Decision: use SQLite for Locus memory.',
      evidence: { source: 'test' },
      source: 'codex',
      projectRoot: 'C:\\Projects\\Locus',
    });
    const other = store.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      summary: 'Decision: use PostgreSQL for another app.',
      evidence: { source: 'test' },
      source: 'codex',
      projectRoot: 'C:\\Projects\\Other',
    });

    expect(locus.projectRoot).toBe('c:/projects/locus');
    expect(other.projectRoot).toBe('c:/projects/other');
    expect(store.listByTopic('database_choice', { projectRoot: 'C:/Projects/Locus' })).toEqual([
      expect.objectContaining({ id: locus.id, projectRoot: 'c:/projects/locus' }),
    ]);
    expect(store.listByTopic('database_choice', { projectRoot: 'C:/Projects/Missing' })).toEqual(
      [],
    );
  });

  it('scopes memory-type lookups by project root', async () => {
    const { runMigrations } = await import('../../src/storage/migrations.js');
    const { DurableMemoryStore } = await import('../../src/memory/durable.js');

    runMigrations(adapter, false);

    const store = new DurableMemoryStore(adapter, false);
    const nextStep = store.insert({
      topicKey: 'track_d',
      memoryType: 'next_step',
      summary: 'Next step: implement Track D project scope.',
      evidence: { source: 'test' },
      source: 'codex',
      projectRoot: 'C:/Projects/Locus',
    });
    store.insert({
      topicKey: 'track_d',
      memoryType: 'next_step',
      summary: 'Next step: implement unrelated project scope.',
      evidence: { source: 'test' },
      source: 'codex',
      projectRoot: 'C:/Projects/Other',
    });

    expect(store.listByMemoryType('next_step', { projectRoot: 'C:/Projects/Locus' })).toEqual([
      expect.objectContaining({ id: nextStep.id, projectRoot: 'c:/projects/locus' }),
    ]);
  });
});
