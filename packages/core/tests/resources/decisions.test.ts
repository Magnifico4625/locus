import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateDecisions } from '../../src/resources/decisions.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { DatabaseAdapter } from '../../src/types.js';
import { estimateTokens } from '../../src/utils.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

function insertMemory(db: DatabaseAdapter, content: string, updatedAt?: number): void {
  const now = updatedAt ?? Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['semantic', content, '[]', now, now],
  );
}

function insertEpisodicMemory(db: DatabaseAdapter, content: string, updatedAt?: number): void {
  const now = updatedAt ?? Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['episodic', content, '[]', now, now],
  );
}

describe('generateDecisions', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-decisions-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Test 1: Empty DB ───────────────────────────────────────────────────────

  it('returns "No decisions recorded yet." when DB is empty', () => {
    const result = generateDecisions(adapter);
    expect(result).toBe('No decisions recorded yet.');
  });

  // ── Test 2: Single memory ──────────────────────────────────────────────────

  it('returns one bullet line for a single memory', () => {
    insertMemory(adapter, 'Use Zod for runtime validation');
    const result = generateDecisions(adapter);
    expect(result).toBe('- Use Zod for runtime validation');
  });

  // ── Test 3: Multiple memories sorted by most recent first ─────────────────

  it('shows all entries sorted by most recently updated first', () => {
    const base = 1_700_000_000_000;
    insertMemory(adapter, 'Decision A', base + 1000);
    insertMemory(adapter, 'Decision B', base + 3000);
    insertMemory(adapter, 'Decision C', base + 2000);
    insertMemory(adapter, 'Decision D', base + 5000);
    insertMemory(adapter, 'Decision E', base + 4000);

    const result = generateDecisions(adapter);
    const lines = result.split('\n');

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('- Decision D');
    expect(lines[1]).toBe('- Decision E');
    expect(lines[2]).toBe('- Decision B');
    expect(lines[3]).toBe('- Decision C');
    expect(lines[4]).toBe('- Decision A');
  });

  // ── Test 4: Exactly 15 memories — all shown, no overflow message ───────────

  it('shows exactly 15 entries with no overflow line when total is 15', () => {
    for (let i = 1; i <= 15; i++) {
      insertMemory(adapter, `Decision ${i}`);
    }

    const result = generateDecisions(adapter);
    const lines = result.split('\n');

    expect(lines).toHaveLength(15);
    for (const line of lines) {
      expect(line.startsWith('- ')).toBe(true);
    }
    expect(result).not.toContain('older');
  });

  // ── Test 5: 20 memories — 15 shown + overflow message ─────────────────────

  it('shows 15 most recent entries and appends overflow message for 20 total', () => {
    const base = 1_700_000_000_000;
    for (let i = 1; i <= 20; i++) {
      insertMemory(adapter, `Decision ${i}`, base + i * 1000);
    }

    const result = generateDecisions(adapter);
    const lines = result.split('\n');

    // 15 bullet lines + 1 overflow line = 16
    expect(lines).toHaveLength(16);

    // First 15 lines are bullet points
    for (let i = 0; i < 15; i++) {
      expect(lines[i]).toMatch(/^- /);
    }

    // Last line is the overflow notice
    expect(lines[15]).toBe('  (+5 older — use memory_search)');

    // Most recent 15 decisions (20 down to 6) should appear
    expect(lines[0]).toBe('- Decision 20');
    expect(lines[14]).toBe('- Decision 6');
  });

  // ── Test 6: Long content truncated to 100 chars with "..." ────────────────

  it('truncates content longer than 100 chars to 100 chars followed by "..."', () => {
    const longContent = 'A'.repeat(101);
    insertMemory(adapter, longContent);

    const result = generateDecisions(adapter);
    // "- " (2 chars) + 100 chars + "..." = line
    const expected = `- ${'A'.repeat(100)}...`;
    expect(result).toBe(expected);
  });

  it('does not truncate content exactly 100 chars long', () => {
    const exactContent = 'B'.repeat(100);
    insertMemory(adapter, exactContent);

    const result = generateDecisions(adapter);
    expect(result).toBe(`- ${'B'.repeat(100)}`);
    expect(result).not.toContain('...');
  });

  // ── Test 7: Token budget stays under 500 ──────────────────────────────────

  it('keeps token count under 500 for maximum 15 entries with max-length content', () => {
    // Each line: "- " + 100 chars + "..." = 105 chars
    // Plus overflow line: "  (+5 older — use memory_search)" ~ 33 chars
    // 20 entries (15 shown + overflow for 20 total)
    for (let i = 1; i <= 20; i++) {
      insertMemory(adapter, 'X'.repeat(101));
    }

    const result = generateDecisions(adapter);
    const tokens = estimateTokens(result);
    expect(tokens).toBeLessThan(500);
  });

  it('keeps token count under 500 for exactly 15 entries with max-length content', () => {
    for (let i = 1; i <= 15; i++) {
      insertMemory(adapter, 'Y'.repeat(101));
    }

    const result = generateDecisions(adapter);
    const tokens = estimateTokens(result);
    expect(tokens).toBeLessThan(500);
  });

  // ── Test 8: Only semantic layer entries included ───────────────────────────

  it('excludes episodic layer entries from the output', () => {
    insertMemory(adapter, 'Semantic decision one');
    insertEpisodicMemory(adapter, 'Episodic note — should not appear');
    insertMemory(adapter, 'Semantic decision two');

    const result = generateDecisions(adapter);
    const lines = result.split('\n');

    expect(lines).toHaveLength(2);
    expect(result).toContain('Semantic decision one');
    expect(result).toContain('Semantic decision two');
    expect(result).not.toContain('Episodic note');
  });

  it('returns "No decisions recorded yet." when only episodic entries exist', () => {
    insertEpisodicMemory(adapter, 'Episodic entry only');

    const result = generateDecisions(adapter);
    expect(result).toBe('No decisions recorded yet.');
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('overflow count is accurate when total is 16 (shows 15 + 1 older)', () => {
    for (let i = 1; i <= 16; i++) {
      insertMemory(adapter, `Decision ${i}`);
    }

    const result = generateDecisions(adapter);
    expect(result).toContain('(+1 older — use memory_search)');
  });

  it('each bullet line starts with "- "', () => {
    insertMemory(adapter, 'Alpha');
    insertMemory(adapter, 'Beta');
    insertMemory(adapter, 'Gamma');

    const result = generateDecisions(adapter);
    for (const line of result.split('\n')) {
      if (!line.startsWith('  (')) {
        expect(line.startsWith('- ')).toBe(true);
      }
    }
  });
});
