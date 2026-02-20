import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EpisodicMemory } from '../../src/memory/episodic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('EpisodicMemory', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let episodic: EpisodicMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-episodic-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    episodic = new EpisodicMemory(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── addEvent ───

  it('addEvent creates entry with layer=episodic and correct sessionId', () => {
    const entry = episodic.addEvent('user asked about TypeScript', 'session-abc');
    expect(entry.layer).toBe('episodic');
    expect(entry.sessionId).toBe('session-abc');
  });

  it('addEvent returns valid MemoryEntry with id and timestamps', () => {
    const before = Date.now();
    const entry = episodic.addEvent('tool invocation recorded', 'session-001');
    const after = Date.now();

    expect(typeof entry.id).toBe('number');
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.content).toBe('tool invocation recorded');
    expect(entry.tags).toEqual([]);
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt).toBeLessThanOrEqual(after);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(before);
    expect(entry.updatedAt).toBeLessThanOrEqual(after);
  });

  it('addEvent multiple events for same session share sessionId', () => {
    const sessionId = 'session-shared';
    const e1 = episodic.addEvent('first event', sessionId);
    const e2 = episodic.addEvent('second event', sessionId);
    const e3 = episodic.addEvent('third event', sessionId);

    expect(e1.sessionId).toBe(sessionId);
    expect(e2.sessionId).toBe(sessionId);
    expect(e3.sessionId).toBe(sessionId);
    expect(e1.id).not.toBe(e2.id);
    expect(e2.id).not.toBe(e3.id);
  });

  // ─── getRecent ───

  it('getRecent returns entries ordered by created_at DESC', () => {
    episodic.addEvent('oldest event', 'session-x');
    episodic.addEvent('middle event', 'session-x');
    episodic.addEvent('newest event', 'session-x');

    const entries = episodic.getRecent(10);
    expect(entries.length).toBe(3);
    // Descending order: newest first
    expect(entries[0]?.content).toBe('newest event');
    expect(entries[1]?.content).toBe('middle event');
    expect(entries[2]?.content).toBe('oldest event');
  });

  it('getRecent respects limit parameter', () => {
    episodic.addEvent('event 1', 'session-limit');
    episodic.addEvent('event 2', 'session-limit');
    episodic.addEvent('event 3', 'session-limit');
    episodic.addEvent('event 4', 'session-limit');
    episodic.addEvent('event 5', 'session-limit');

    const entries = episodic.getRecent(3);
    expect(entries.length).toBe(3);
  });

  it('getRecent returns empty array when no entries', () => {
    const entries = episodic.getRecent(50);
    expect(entries).toEqual([]);
  });

  // ─── getBufferTokens ───

  it('getBufferTokens estimates correctly (sum of token estimates)', () => {
    // estimateTokens = Math.ceil(length / 4)
    // 'hello world' = 11 chars => ceil(11/4) = 3
    // 'another entry' = 13 chars => ceil(13/4) = 4
    // total = 7
    episodic.addEvent('hello world', 'session-tokens');
    episodic.addEvent('another entry', 'session-tokens');

    const tokens = episodic.getBufferTokens();
    expect(tokens).toBe(
      Math.ceil('hello world'.length / 4) + Math.ceil('another entry'.length / 4),
    );
  });

  it('getBufferTokens returns 0 when no entries', () => {
    const tokens = episodic.getBufferTokens();
    expect(tokens).toBe(0);
  });

  // ─── count ───

  it('count returns correct count of episodic entries', () => {
    episodic.addEvent('event A', 'session-count');
    episodic.addEvent('event B', 'session-count');
    episodic.addEvent('event C', 'session-count');

    expect(episodic.count()).toBe(3);
  });

  it('count returns 0 when empty', () => {
    expect(episodic.count()).toBe(0);
  });

  it('count only counts episodic entries, not semantic', () => {
    const now = Date.now();
    // Insert a semantic entry directly
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', 'semantic content', '[]', now, now],
    );
    episodic.addEvent('episodic event', 'session-mix');

    expect(episodic.count()).toBe(1);
  });

  // ─── sessionCount ───

  it('sessionCount returns number of distinct sessions', () => {
    episodic.addEvent('event from session 1', 'session-alpha');
    episodic.addEvent('event from session 1 again', 'session-alpha');
    episodic.addEvent('event from session 2', 'session-beta');
    episodic.addEvent('event from session 3', 'session-gamma');

    expect(episodic.sessionCount()).toBe(3);
  });

  it('sessionCount returns 0 when empty', () => {
    expect(episodic.sessionCount()).toBe(0);
  });

  // ─── getSessionEntries ───

  it('getSessionEntries returns entries for specific session in chronological order', () => {
    episodic.addEvent('session A - first', 'session-A');
    episodic.addEvent('session B - only', 'session-B');
    episodic.addEvent('session A - second', 'session-A');
    episodic.addEvent('session A - third', 'session-A');

    const entries = episodic.getSessionEntries('session-A');
    expect(entries.length).toBe(3);
    // Chronological (ASC) order
    expect(entries[0]?.content).toBe('session A - first');
    expect(entries[1]?.content).toBe('session A - second');
    expect(entries[2]?.content).toBe('session A - third');
    // All belong to session-A
    for (const entry of entries) {
      expect(entry.sessionId).toBe('session-A');
    }
  });

  it('getSessionEntries returns empty for non-existent session', () => {
    episodic.addEvent('some event', 'session-exists');
    const entries = episodic.getSessionEntries('session-nonexistent');
    expect(entries).toEqual([]);
  });
});
