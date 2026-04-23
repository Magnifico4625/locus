import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { ConfirmationTokenStore } from '../../src/tools/confirmation-token.js';
import { handleForget } from '../../src/tools/forget.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('handleForget', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let durable: DurableMemoryStore;
  let semantic: SemanticMemory;
  let tokenStore: ConfirmationTokenStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-forget-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    durable = new DurableMemoryStore(adapter, false);
    semantic = new SemanticMemory(adapter, false);
    tokenStore = new ConfirmationTokenStore('forget');
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 0 matches ─────────────────────────────────────────────────────────────

  it('returns deleted=0 with appropriate message when no entries match', () => {
    semantic.add('Use Zod for validation', ['zod']);

    const result = handleForget('nonexistentxyz123', { semantic, tokenStore });

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(0);
      expect(result.message).toContain('No matching');
    }
  });

  // ── <=5 matches ───────────────────────────────────────────────────────────

  it('deletes all matches and returns correct count when <=5 entries match', () => {
    semantic.add('TypeScript decision one', ['ts']);
    semantic.add('TypeScript decision two', ['ts']);
    semantic.add('TypeScript decision three', ['ts']);

    const result = handleForget('TypeScript', { semantic, tokenStore });

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(3);
      expect(result.message).toContain('3');
    }
    expect(semantic.count()).toBe(0);
  });

  it('deletes exactly 5 matches without requiring confirmation', () => {
    for (let i = 1; i <= 5; i++) {
      semantic.add(`Exact five entry ${i}`, ['batch']);
    }

    const result = handleForget('Exact five', { semantic, tokenStore });

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(5);
    }
    expect(semantic.count()).toBe(0);
  });

  it('deletes a single match (edge case: 1 entry)', () => {
    semantic.add('Solo entry to remove', ['solo']);

    const result = handleForget('Solo entry', { semantic, tokenStore });

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(1);
      // Singular form: "entry" not "entries"
      expect(result.message).toContain('1');
    }
    expect(semantic.count()).toBe(0);
  });

  // ── >5 matches, no token ───────────────────────────────────────────────────

  it('returns pending_confirmation when >5 entries match and no token is provided', () => {
    for (let i = 1; i <= 6; i++) {
      semantic.add(`BulkDelete entry ${i}`, ['bulk']);
    }

    const result = handleForget('BulkDelete', { semantic, tokenStore });

    expect(result.status).toBe('pending_confirmation');
    // Entries must NOT have been deleted
    expect(semantic.count()).toBe(6);
  });

  it('pending response includes correct match count and a valid token format', () => {
    for (let i = 1; i <= 7; i++) {
      semantic.add(`Pending entry ${i}`, ['pending']);
    }

    const result = handleForget('Pending entry', { semantic, tokenStore });

    expect(result.status).toBe('pending_confirmation');
    if (result.status === 'pending_confirmation') {
      expect(result.matches).toBe(7);
      expect(result.confirmToken).toMatch(/^forget-[0-9a-f]{8}$/);
      expect(result.message).toContain('7');
      expect(result.message).toContain(result.confirmToken);
    }
  });

  // ── >5 matches, with valid token ──────────────────────────────────────────

  it('deletes all entries when >5 matches and a valid token is provided', () => {
    for (let i = 1; i <= 6; i++) {
      semantic.add(`ConfirmedDelete entry ${i}`, ['confirm']);
    }

    // First call — get token
    const pending = handleForget('ConfirmedDelete', { semantic, tokenStore });
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    // Second call — confirm with token
    const result = handleForget('ConfirmedDelete', { semantic, tokenStore }, pending.confirmToken);

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(6);
      expect(result.message).toContain('6');
    }
    expect(semantic.count()).toBe(0);
  });

  // ── invalid / expired token ────────────────────────────────────────────────

  it('returns error status for an invalid (unknown) token', () => {
    for (let i = 1; i <= 6; i++) {
      semantic.add(`InvalidToken entry ${i}`, ['inv']);
    }

    const result = handleForget('InvalidToken', { semantic, tokenStore }, 'forget-00000000');

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Invalid or expired');
    }
    // Entries must NOT have been deleted
    expect(semantic.count()).toBe(6);
  });

  it('returns error status for an expired token', () => {
    for (let i = 1; i <= 6; i++) {
      semantic.add(`ExpiredToken entry ${i}`, ['exp']);
    }

    // Create a store with a very short TTL and generate a token in the past
    const shortStore = new ConfirmationTokenStore('forget', 1000);
    const pastNow = Date.now() - 2000; // 2 seconds ago
    const expiredToken = shortStore.generate(pastNow);

    const result = handleForget('ExpiredToken', { semantic, tokenStore: shortStore }, expiredToken);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Invalid or expired');
    }
    expect(semantic.count()).toBe(6);
  });

  it('token is single-use — reusing a valid token fails on the second call', () => {
    for (let i = 1; i <= 6; i++) {
      semantic.add(`SingleUse entry ${i}`, ['once']);
    }

    // Obtain a token
    const pending = handleForget('SingleUse', { semantic, tokenStore });
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    const { confirmToken } = pending;

    // First use — succeeds and deletes all
    const first = handleForget('SingleUse', { semantic, tokenStore }, confirmToken);
    expect(first.status).toBe('deleted');

    // Re-populate so there are matches again to avoid 0-matches short-circuit
    for (let i = 1; i <= 6; i++) {
      semantic.add(`SingleUse entry ${i}`, ['once']);
    }

    // Second use of the same token — must fail
    const second = handleForget('SingleUse', { semantic, tokenStore }, confirmToken);
    expect(second.status).toBe('error');
    if (second.status === 'error') {
      expect(second.message).toContain('Invalid or expired');
    }
  });

  it('deletes a durable memory by explicit durable id target', () => {
    const durableEntry = durable.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      summary: 'Use SQLite for local storage.',
      evidence: { source: 'test' },
      source: 'codex',
    });

    const result = handleForget(`durable:${durableEntry.id}`, {
      semantic,
      tokenStore,
      durable,
    } as never);

    expect(result.status).toBe('deleted');
    if (result.status === 'deleted') {
      expect(result.deleted).toBe(1);
    }

    const remaining = adapter.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM durable_memories WHERE id = ?',
      [durableEntry.id],
    );
    expect(remaining?.cnt ?? 0).toBe(0);
  });

  it('requires confirmation when deleting a durable topic with more than five entries', () => {
    for (let i = 0; i < 6; i++) {
      durable.insert({
        topicKey: 'database_choice',
        memoryType: 'decision',
        summary: `Database decision ${i}`,
        evidence: { source: 'test' },
        source: 'codex',
      });
    }

    const pending = handleForget('topic:database_choice', {
      semantic,
      tokenStore,
      durable,
    } as never);

    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') {
      return;
    }

    const confirmed = handleForget(
      'topic:database_choice',
      { semantic, tokenStore, durable } as never,
      pending.confirmToken,
    );

    expect(confirmed.status).toBe('deleted');
    if (confirmed.status === 'deleted') {
      expect(confirmed.deleted).toBe(6);
    }
  });
});
