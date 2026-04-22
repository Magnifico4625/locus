import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import { reviewDurableMemories } from '../../src/memory/review.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('reviewDurableMemories', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let durable: DurableMemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-review-memory-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    durable = new DurableMemoryStore(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns superseded durable memories as review candidates', () => {
    const replacement = durable.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      summary: 'Use SQLite for local durable storage.',
      evidence: { source: 'test' },
      source: 'codex',
    });
    const superseded = durable.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      state: 'superseded',
      summary: 'Use PostgreSQL for local durable storage.',
      evidence: { source: 'test' },
      source: 'codex',
      supersededById: replacement.id,
    });

    const result = reviewDurableMemories({ db: adapter });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durableId: superseded.id,
          topicKey: 'database_choice',
          state: 'superseded',
          reason: 'superseded_by_newer_memory',
          recommendedAction: 'delete',
        }),
      ]),
    );
  });

  it('suggests stale durable memories without deleting them', () => {
    const stale = durable.insert({
      topicKey: 'team_preference',
      memoryType: 'preference',
      state: 'stale',
      summary: 'Prefer verbose commit messages for every branch.',
      evidence: { source: 'test' },
      source: 'manual',
    });

    const beforeCount =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;
    const result = reviewDurableMemories({ db: adapter });
    const afterCount =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durableId: stale.id,
          state: 'stale',
          reason: 'stale_low_value',
          recommendedAction: 'review',
        }),
      ]),
    );
    expect(beforeCount).toBe(afterCount);
  });
});
