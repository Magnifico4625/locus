import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleReview } from '../../src/tools/review.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('handleReview', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let durable: DurableMemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-review-tool-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    durable = new DurableMemoryStore(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns machine-friendly reasons and recommended actions', () => {
    const stale = durable.insert({
      topicKey: 'coding_style',
      memoryType: 'style',
      state: 'stale',
      summary: 'Prefer long explanatory block comments in every file.',
      evidence: { source: 'test' },
      source: 'manual',
    });

    const result = handleReview(
      { db: adapter },
      {
        limit: 10,
      },
    );

    expect(result).toMatchObject({
      totalCandidates: 1,
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        durableId: stale.id,
        state: 'stale',
        reason: 'stale_low_value',
        recommendedAction: 'review',
      }),
    ]);
  });

  it('never deletes durable memory entries while reviewing them', () => {
    durable.insert({
      topicKey: 'auth_strategy',
      memoryType: 'decision',
      state: 'archivable',
      summary: 'GitHub OAuth is the current auth strategy.',
      evidence: { source: 'test' },
      source: 'codex',
    });

    const beforeCount =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;
    handleReview({ db: adapter }, {});
    const afterCount =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM durable_memories')?.cnt ?? 0;

    expect(beforeCount).toBe(afterCount);
  });
});
