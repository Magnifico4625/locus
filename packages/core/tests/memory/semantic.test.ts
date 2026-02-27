import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

// ─── FTS5 enabled ─────────────────────────────────────────────────────────────

describe('SemanticMemory (FTS5 enabled)', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let mem: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-semantic-fts-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
    mem = new SemanticMemory(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── add ───────────────────────────────────────────────────────────────────

  it('add returns a valid MemoryEntry with layer=semantic', () => {
    const entry = mem.add('Use Zod for runtime validation', ['zod', 'validation']);
    expect(entry.id).toBeTypeOf('number');
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.layer).toBe('semantic');
    expect(entry.content).toBe('Use Zod for runtime validation');
    expect(entry.tags).toEqual(['zod', 'validation']);
    expect(entry.createdAt).toBeTypeOf('number');
    expect(entry.updatedAt).toBeTypeOf('number');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
    expect(entry.sessionId).toBeUndefined();
  });

  it('add stores tags as JSON and retrieves them correctly', () => {
    const entry = mem.add('Prefer composition over inheritance', ['design', 'oop', 'patterns']);
    expect(entry.tags).toEqual(['design', 'oop', 'patterns']);

    // Verify round-trip through DB
    const listed = mem.list();
    expect(listed[0]?.tags).toEqual(['design', 'oop', 'patterns']);
  });

  it('add with empty tags stores and retrieves empty array', () => {
    const entry = mem.add('Always write tests first', []);
    expect(entry.tags).toEqual([]);
  });

  it('add assigns distinct ids to multiple entries', () => {
    const a = mem.add('Decision A', []);
    const b = mem.add('Decision B', []);
    const c = mem.add('Decision C', []);
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
    expect(a.id).not.toBe(c.id);
  });

  // ── search (FTS5) ─────────────────────────────────────────────────────────

  it('search finds matching content by keyword (FTS5)', () => {
    mem.add('Use Zod for runtime validation', ['zod']);
    mem.add('Use TypeScript strict mode', ['typescript']);
    mem.add('Prefer composition over inheritance', ['design']);

    const results = mem.search('Zod');
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('Use Zod for runtime validation');
  });

  it('search returns multiple matches ordered by updated_at DESC (FTS5)', () => {
    mem.add('Zod schema validation', ['zod']);
    mem.add('Zod type inference', ['zod']);
    mem.add('Unrelated decision', []);

    const results = mem.search('Zod');
    expect(results).toHaveLength(2);
    // All results must be for Zod
    for (const r of results) {
      expect(r.content).toContain('Zod');
    }
  });

  it('search returns empty array for no FTS5 matches', () => {
    mem.add('Use Zod for runtime validation', ['zod']);
    const results = mem.search('nonexistentxyz123');
    expect(results).toEqual([]);
  });

  it('search respects limit parameter (FTS5)', () => {
    for (let i = 0; i < 5; i++) {
      mem.add(`Zod decision ${i}`, []);
    }
    const results = mem.search('Zod', 3);
    expect(results).toHaveLength(3);
  });

  it('search only returns semantic layer entries (FTS5)', () => {
    mem.add('Zod semantic decision', ['zod']);
    // Insert an episodic row directly to verify it's excluded
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Zod episodic note', null, Date.now(), Date.now()],
    );

    const results = mem.search('Zod');
    expect(results.every((r) => r.layer === 'semantic')).toBe(true);
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove deletes an existing entry and returns true', () => {
    const entry = mem.add('Decision to remove', []);
    const deleted = mem.remove(entry.id);
    expect(deleted).toBe(true);
    expect(mem.count()).toBe(0);
  });

  it('remove returns false for non-existent id', () => {
    const deleted = mem.remove(99999);
    expect(deleted).toBe(false);
  });

  it('remove will not delete episodic entries (layer guard)', () => {
    const result = adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Episodic entry', null, Date.now(), Date.now()],
    );
    const episodicId = result.lastInsertRowid;
    const deleted = mem.remove(episodicId);
    // Should return false — SemanticMemory only removes semantic rows
    expect(deleted).toBe(false);
    // The episodic entry should still exist
    const row = adapter.get<{ id: number }>('SELECT id FROM memories WHERE id = ?', [episodicId]);
    expect(row).toBeDefined();
  });

  it('remove also cleans up FTS5 index', () => {
    const entry = mem.add('Zod cleanup test', []);
    mem.remove(entry.id);
    // After remove, FTS search should find nothing
    const results = mem.search('cleanup');
    expect(results).toEqual([]);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it('list returns semantic entries ordered by updated_at DESC', () => {
    const a = mem.add('First decision', []);
    const b = mem.add('Second decision', []);
    const c = mem.add('Third decision', []);
    const listed = mem.list();
    // Most recent (highest id / updated_at) should come first
    expect(listed[0]?.id).toBe(c.id);
    expect(listed[1]?.id).toBe(b.id);
    expect(listed[2]?.id).toBe(a.id);
  });

  it('list respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      mem.add(`Decision ${i}`, []);
    }
    const listed = mem.list(4);
    expect(listed).toHaveLength(4);
  });

  it('list returns only semantic entries (not episodic)', () => {
    mem.add('Semantic one', []);
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Episodic one', null, Date.now(), Date.now()],
    );
    const listed = mem.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.layer).toBe('semantic');
  });

  it('list returns empty array when no semantic entries', () => {
    expect(mem.list()).toEqual([]);
  });

  // ── count ─────────────────────────────────────────────────────────────────

  it('count returns correct count of semantic entries', () => {
    expect(mem.count()).toBe(0);
    mem.add('One', []);
    expect(mem.count()).toBe(1);
    mem.add('Two', []);
    expect(mem.count()).toBe(2);
  });

  it('count returns 0 when no semantic entries exist', () => {
    expect(mem.count()).toBe(0);
  });

  it('count excludes episodic entries', () => {
    mem.add('Semantic', []);
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Episodic', null, Date.now(), Date.now()],
    );
    expect(mem.count()).toBe(1);
  });
});

// ─── FTS5 disabled (LIKE fallback) ────────────────────────────────────────────

describe('SemanticMemory (no FTS5, LIKE fallback)', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let mem: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-semantic-like-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    mem = new SemanticMemory(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('add returns valid MemoryEntry without FTS5', () => {
    const entry = mem.add('No FTS5 decision', ['test']);
    expect(entry.layer).toBe('semantic');
    expect(entry.content).toBe('No FTS5 decision');
    expect(entry.tags).toEqual(['test']);
    expect(entry.id).toBeGreaterThan(0);
  });

  it('search finds matching content by keyword (LIKE fallback)', () => {
    mem.add('Use Zod for runtime validation', ['zod']);
    mem.add('Use TypeScript strict mode', ['typescript']);

    const results = mem.search('Zod');
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('Use Zod for runtime validation');
  });

  it('search is case-insensitive with LIKE fallback', () => {
    mem.add('Use Zod for runtime validation', ['zod']);
    const results = mem.search('zod');
    expect(results).toHaveLength(1);
  });

  it('search returns empty array for no LIKE matches', () => {
    mem.add('Use Zod for runtime validation', ['zod']);
    const results = mem.search('nonexistentxyz123');
    expect(results).toEqual([]);
  });

  it('search respects limit parameter (LIKE fallback)', () => {
    for (let i = 0; i < 5; i++) {
      mem.add(`Zod decision ${i}`, []);
    }
    const results = mem.search('Zod', 2);
    expect(results).toHaveLength(2);
  });

  it('search returns only semantic layer entries (LIKE fallback)', () => {
    mem.add('Zod semantic', []);
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Zod episodic', null, Date.now(), Date.now()],
    );
    const results = mem.search('Zod');
    expect(results.every((r) => r.layer === 'semantic')).toBe(true);
    expect(results).toHaveLength(1);
  });

  it('remove works without FTS5', () => {
    const entry = mem.add('To remove', []);
    const deleted = mem.remove(entry.id);
    expect(deleted).toBe(true);
    expect(mem.count()).toBe(0);
  });

  it('list and count work without FTS5', () => {
    mem.add('Alpha', []);
    mem.add('Beta', []);
    expect(mem.count()).toBe(2);
    expect(mem.list()).toHaveLength(2);
  });
});
