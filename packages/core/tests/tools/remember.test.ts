import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleRemember } from '../../src/tools/remember.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('handleRemember', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-remember-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    semantic = new SemanticMemory(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores text via SemanticMemory and returns a valid MemoryEntry', () => {
    const entry = handleRemember('Always write tests first', ['tdd'], { semantic });

    expect(entry.id).toBeTypeOf('number');
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.content).toBe('Always write tests first');
    expect(entry.tags).toEqual(['tdd']);
    expect(entry.createdAt).toBeTypeOf('number');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeTypeOf('number');
    expect(entry.updatedAt).toBeGreaterThan(0);
  });

  it('applies redaction before storing — API key is sanitized', () => {
    const entry = handleRemember('API_KEY=sk-abc123xyz456789012345', [], { semantic });

    // The raw secret must not appear in stored content
    expect(entry.content).not.toContain('sk-abc123xyz456789012345');
    // The redacted placeholder must be present
    expect(entry.content).toContain('[REDACTED]');

    // Verify the DB also has the redacted version
    const stored = semantic.list();
    expect(stored[0]?.content).not.toContain('sk-abc123xyz456789012345');
  });

  it('stores tags correctly and they are retrievable', () => {
    const entry = handleRemember('Use composition over inheritance', ['design', 'oop'], {
      semantic,
    });

    expect(entry.tags).toEqual(['design', 'oop']);

    // Verify round-trip through DB
    const listed = semantic.list();
    expect(listed[0]?.tags).toEqual(['design', 'oop']);
  });

  it('returns entry with layer = "semantic"', () => {
    const entry = handleRemember('Prefer immutability', ['fp'], { semantic });

    expect(entry.layer).toBe('semantic');
  });

  it('handles empty tags array correctly', () => {
    const entry = handleRemember('No tags here', [], { semantic });

    expect(entry.tags).toEqual([]);

    const listed = semantic.list();
    expect(listed[0]?.tags).toEqual([]);
  });
});
