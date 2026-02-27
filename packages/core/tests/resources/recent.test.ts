import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateRecent } from '../../src/resources/recent.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import type { DatabaseAdapter } from '../../src/types.js';
import { estimateTokens } from '../../src/utils.js';

// ─── Adapter factory ──────────────────────────────────────────────────────────

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

// ─── Insert helper ────────────────────────────────────────────────────────────

function insertEpisodic(
  db: DatabaseAdapter,
  sessionId: string,
  content: string,
  createdAt?: number,
): void {
  const ts = createdAt ?? Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES (?, ?, ?, ?, ?, ?)',
    ['episodic', content, '[]', ts, ts, sessionId],
  );
}

function insertSemantic(db: DatabaseAdapter, content: string): void {
  const ts = Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ['semantic', content, '[]', ts, ts],
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateRecent', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-recent-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── Test 1: Empty DB ─────────────────────────────────────────────────────

  it('returns no-sessions message when DB is empty', () => {
    const result = generateRecent(adapter);
    expect(result).toBe('No sessions recorded. Start working and Locus will track.');
  });

  // ─── Test 2: Single session, single entry ────────────────────────────────

  it('formats a single session with one entry correctly', () => {
    const ts = Date.now() - 3600000; // 1 hour ago
    insertEpisodic(adapter, 'session-1', 'Fixed authentication bug', ts);

    const result = generateRecent(adapter);

    expect(result).toContain('Session 1');
    expect(result).toContain('Fixed authentication bug');
    expect(result).toContain('ago');
    expect(result).toContain('Files:');
  });

  // ─── Test 3: Single session, multiple entries — last entry is summary ────

  it('uses the last (most recent) entry as the session summary', () => {
    const base = Date.now() - 7200000; // 2 hours ago
    insertEpisodic(adapter, 'session-A', 'First event happened', base);
    insertEpisodic(adapter, 'session-A', 'Second event happened', base + 60000);
    insertEpisodic(adapter, 'session-A', 'Final summary of the session', base + 120000);

    const result = generateRecent(adapter);

    expect(result).toContain('Final summary of the session');
    expect(result).not.toContain('First event happened');
    expect(result).not.toContain('Second event happened');
  });

  // ─── Test 4: Multiple sessions sorted most recent first ──────────────────

  it('sorts sessions most recent first', () => {
    const now = Date.now();
    insertEpisodic(adapter, 'session-old', 'Oldest session', now - 86400000 * 3); // 3 days ago
    insertEpisodic(adapter, 'session-mid', 'Middle session', now - 86400000); // 1 day ago
    insertEpisodic(adapter, 'session-new', 'Newest session', now - 3600000); // 1 hour ago

    const result = generateRecent(adapter);

    const pos1 = result.indexOf('Newest session');
    const pos2 = result.indexOf('Middle session');
    const pos3 = result.indexOf('Oldest session');

    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeGreaterThanOrEqual(0);
    expect(pos3).toBeGreaterThanOrEqual(0);
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });

  // ─── Test 5: File extraction from content ────────────────────────────────

  it('extracts file paths from entry content', () => {
    insertEpisodic(
      adapter,
      'session-files',
      'Refactored src/auth/login.ts and updated lib/utils.js for the new API',
    );

    const result = generateRecent(adapter);

    expect(result).toContain('src/auth/login.ts');
    expect(result).toContain('lib/utils.js');
  });

  it('accumulates files across multiple entries in a session', () => {
    const base = Date.now() - 3600000;
    insertEpisodic(adapter, 'session-multi', 'Edited src/foo.ts', base);
    insertEpisodic(adapter, 'session-multi', 'Also changed lib/bar.py', base + 1000);
    insertEpisodic(adapter, 'session-multi', 'Session summary', base + 2000);

    const result = generateRecent(adapter);

    expect(result).toContain('src/foo.ts');
    expect(result).toContain('lib/bar.py');
  });

  // ─── Test 6: More than 5 files → shows 5 + N more ────────────────────────

  it('shows at most 5 files and appends "+ N more" for extras', () => {
    insertEpisodic(
      adapter,
      'session-manyfiles',
      'Changed src/a.ts src/b.ts src/c.ts src/d.ts src/e.ts src/f.ts src/g.ts',
    );

    const result = generateRecent(adapter);

    // Should show at most 5 file names explicitly
    expect(result).toContain('more');

    // Count how many .ts paths appear before the "more"
    const filesLine = result.split('\n').find((l) => l.startsWith('  Files:')) ?? '';
    const moreMatch = filesLine.match(/\+ (\d+) more/);
    expect(moreMatch).not.toBeNull();
    const extra = Number(moreMatch?.[1] ?? '0');
    expect(extra).toBeGreaterThanOrEqual(1);

    // Total shown + extra = total unique files
    const shownFiles = filesLine
      .replace(/\+ \d+ more/, '')
      .replace('  Files:', '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(shownFiles.length).toBe(5);
    expect(shownFiles.length + extra).toBeGreaterThanOrEqual(6);
  });

  // ─── Test 7: Session summary truncated to 120 chars ──────────────────────

  it('truncates session summary to 120 characters', () => {
    const longContent = 'A'.repeat(200);
    insertEpisodic(adapter, 'session-long', longContent);

    const result = generateRecent(adapter);

    // Extract the summary line (first line that contains "Session 1")
    const summaryLine = result.split('\n').find((l) => l.includes('Session 1')) ?? '';
    // After "Session 1 (... ago): " the summary should be at most 120 chars
    const colonIdx = summaryLine.indexOf('): ');
    const summaryPart = colonIdx >= 0 ? summaryLine.slice(colonIdx + 3) : '';
    expect(summaryPart.length).toBeLessThanOrEqual(120);
  });

  // ─── Test 8: Token budget stays under 1000 ───────────────────────────────

  it('keeps total output under 1000 tokens', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const content = `Session summary ${'x'.repeat(300)} session number ${i}`;
      insertEpisodic(adapter, `session-${i}`, content, now - i * 3600000);
    }

    const result = generateRecent(adapter);
    expect(estimateTokens(result)).toBeLessThanOrEqual(1000);
  });

  // ─── Test 9: Max 5 sessions shown ────────────────────────────────────────

  it('shows at most 5 sessions even when more exist', () => {
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      insertEpisodic(adapter, `session-${i}`, `Short summary ${i}`, now - i * 3600000);
    }

    const result = generateRecent(adapter);

    // Count occurrences of "Session N" pattern
    const matches = result.match(/^Session \d+/gm);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeLessThanOrEqual(5);
  });

  // ─── Test 10: Only episodic entries included ──────────────────────────────

  it('ignores semantic entries and only processes episodic ones', () => {
    insertSemantic(adapter, 'This is a semantic memory about TypeScript generics');
    insertEpisodic(adapter, 'session-ep', 'Episodic session event recorded');

    const result = generateRecent(adapter);

    expect(result).not.toBe('No sessions recorded. Start working and Locus will track.');
    expect(result).toContain('Episodic session event recorded');
    expect(result).not.toContain('semantic memory');
  });

  it('returns no-sessions message when only semantic entries exist', () => {
    insertSemantic(adapter, 'Some semantic fact about the codebase');
    insertSemantic(adapter, 'Another semantic fact');

    const result = generateRecent(adapter);
    expect(result).toBe('No sessions recorded. Start working and Locus will track.');
  });

  // ─── Relative time formatting ─────────────────────────────────────────────

  it('formats timestamp from minutes ago correctly', () => {
    const ts = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    insertEpisodic(adapter, 'session-min', 'Some event', ts);

    const result = generateRecent(adapter);
    expect(result).toMatch(/\d+ minute[s]? ago/);
  });

  it('formats timestamp from hours ago correctly', () => {
    const ts = Date.now() - 3 * 3600 * 1000; // 3 hours ago
    insertEpisodic(adapter, 'session-hr', 'Some event', ts);

    const result = generateRecent(adapter);
    expect(result).toMatch(/\d+ hours? ago/);
  });

  it('formats timestamp from days ago correctly', () => {
    const ts = Date.now() - 3 * 86400 * 1000; // 3 days ago
    insertEpisodic(adapter, 'session-days', 'Some event', ts);

    const result = generateRecent(adapter);
    expect(result).toContain('days ago');
  });

  it('formats yesterday correctly', () => {
    const ts = Date.now() - 86400 * 1000; // exactly 1 day ago
    insertEpisodic(adapter, 'session-yesterday', 'Some event', ts);

    const result = generateRecent(adapter);
    expect(result).toContain('yesterday');
  });

  it('formats very recent timestamp as "just now"', () => {
    // Insert with current timestamp (no offset)
    insertEpisodic(adapter, 'session-now', 'Just happened');

    const result = generateRecent(adapter);
    expect(result).toContain('just now');
  });

  // ─── Format structure validation ──────────────────────────────────────────

  it('output lines follow "Session N (time): summary" and "  Files:" format', () => {
    insertEpisodic(adapter, 'session-fmt', 'Implemented login flow in src/auth.ts');

    const result = generateRecent(adapter);
    const lines = result.split('\n');

    // First line: Session N (time): summary
    expect(lines[0]).toMatch(/^Session \d+ \(.+\): .+/);
    // Second line: "  Files: ..."
    expect(lines[1]).toMatch(/^ {2}Files: .+/);
  });

  // ─── Deduplication of files ───────────────────────────────────────────────

  it('deduplicates file paths mentioned multiple times across entries', () => {
    const base = Date.now() - 3600000;
    insertEpisodic(adapter, 'session-dup', 'Edited src/foo.ts heavily', base);
    insertEpisodic(adapter, 'session-dup', 'More changes to src/foo.ts', base + 1000);
    insertEpisodic(adapter, 'session-dup', 'Done with src/foo.ts', base + 2000);

    const result = generateRecent(adapter);
    const filesLine = result.split('\n').find((l) => l.startsWith('  Files:')) ?? '';

    // src/foo.ts should appear exactly once in the files line
    const matches = filesLine.match(/src\/foo\.ts/g);
    expect(matches).toHaveLength(1);
  });
});

// ─── Conversation Event Helpers ────────────────────────────────────────────

let ceCounter = 0;

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: {
    event_id?: string;
    kind: string;
    timestamp?: number;
    payload_json?: string;
    significance?: string;
    session_id?: string;
  },
): void {
  ceCounter++;
  const eventId = opts.event_id ?? `evt-recent-${ceCounter}-${Date.now()}`;
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      'test',
      null,
      '/test/project',
      opts.session_id ?? 'test-session',
      opts.timestamp ?? Date.now(),
      opts.kind,
      opts.payload_json ?? null,
      opts.significance ?? 'medium',
      null,
      Date.now(),
    ],
  );
}

function insertRecentEventFile(db: DatabaseAdapter, eventId: string, filePath: string): void {
  db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [eventId, filePath]);
}

// ─── Conversation Stats Tests ──────────────────────────────────────────────

describe('generateRecent — conversation stats', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-recent-conv-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Shows conversation event counts ──────────────────────────────────

  it('shows conversation event counts when events exist', () => {
    insertConversationEvent(adapter, { kind: 'tool_use' });
    insertConversationEvent(adapter, { kind: 'tool_use' });
    insertConversationEvent(adapter, { kind: 'file_diff' });

    const result = generateRecent(adapter);

    expect(result).toContain('Conversation Activity');
    expect(result).toContain('3');
  });

  // ── 2. Shows event counts by kind ──────────────────────────────────────

  it('shows event counts broken down by kind', () => {
    insertConversationEvent(adapter, { kind: 'tool_use' });
    insertConversationEvent(adapter, { kind: 'tool_use' });
    insertConversationEvent(adapter, { kind: 'tool_use' });
    insertConversationEvent(adapter, { kind: 'file_diff' });
    insertConversationEvent(adapter, { kind: 'user_prompt' });

    const result = generateRecent(adapter);

    expect(result).toContain('tool_use');
    expect(result).toContain('file_diff');
  });

  // ── 3. Shows recent files from event_files (max 5) ─────────────────────

  it('shows recent files from conversation events with hard limit 5', () => {
    for (let i = 0; i < 7; i++) {
      const eventId = `evt-file-${i}`;
      insertConversationEvent(adapter, {
        event_id: eventId,
        kind: 'tool_use',
        payload_json: `{"tool":"Write","files":["src/file${i}.ts"],"status":"success"}`,
      });
      insertRecentEventFile(adapter, eventId, `src/file${i}.ts`);
    }

    const result = generateRecent(adapter);

    expect(result).toContain('Recent files:');
    // Count file paths in the Recent files line
    const recentLine = result.split('\n').find((l) => l.includes('Recent files:')) ?? '';
    // Should have at most 5 files shown + possibly "N more"
    const fileMatches = recentLine.match(/src\/file\d+\.ts/g) ?? [];
    expect(fileMatches.length).toBeLessThanOrEqual(5);
  });

  // ── 4. Shows last 3 prompts at captureLevel='full' ────────────────────

  it('shows last 3 prompts at captureLevel=full', () => {
    for (let i = 1; i <= 5; i++) {
      insertConversationEvent(adapter, {
        event_id: `evt-prompt-${i}`,
        kind: 'user_prompt',
        timestamp: Date.now() - (6 - i) * 60000,
        payload_json: JSON.stringify({ prompt: `User prompt number ${i}` }),
      });
    }

    const result = generateRecent(adapter, 'full');

    expect(result).toContain('Last prompts:');
    expect(result).toContain('User prompt number 5');
    expect(result).toContain('User prompt number 4');
    expect(result).toContain('User prompt number 3');
    expect(result).not.toContain('User prompt number 1');
  });

  // ── 5. No prompts at captureLevel='metadata' ─────────────────────────

  it('does not show prompts at captureLevel=metadata', () => {
    insertConversationEvent(adapter, {
      kind: 'user_prompt',
      payload_json: '{"prompt":"Secret user prompt"}',
    });
    insertConversationEvent(adapter, { kind: 'tool_use' });

    const result = generateRecent(adapter, 'metadata');

    expect(result).not.toContain('Last prompts:');
    expect(result).not.toContain('Secret user prompt');
  });

  // ── 6. No prompts by default (defaults to metadata) ──────────────────

  it('does not show prompts by default', () => {
    insertConversationEvent(adapter, {
      kind: 'user_prompt',
      payload_json: '{"prompt":"Hidden prompt"}',
    });
    insertConversationEvent(adapter, { kind: 'tool_use' });

    const result = generateRecent(adapter);

    expect(result).not.toContain('Last prompts:');
    expect(result).not.toContain('Hidden prompt');
  });

  // ── 7. Never shows AI responses ──────────────────────────────────────

  it('never shows AI response content', () => {
    insertConversationEvent(adapter, {
      kind: 'ai_response',
      payload_json: '{"response":"This is the AI response that should be hidden"}',
    });
    insertConversationEvent(adapter, { kind: 'tool_use' });

    const result = generateRecent(adapter, 'full');

    expect(result).not.toContain('This is the AI response that should be hidden');
  });

  // ── 8. Backwards compat — works with no conversation events ──────────

  it('works with no conversation events (episodic only)', () => {
    insertEpisodic(adapter, 'session-1', 'Did something useful');

    const result = generateRecent(adapter);

    expect(result).toContain('Session 1');
    expect(result).toContain('Did something useful');
    // No conversation section when no events
    expect(result).not.toContain('Conversation Activity');
  });

  // ── 9. Token budget under 1000 with both sections ───────────────────

  it('stays within 1000 token budget with both episodic and conversation', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      insertEpisodic(adapter, `session-${i}`, `Session summary ${i}`, now - i * 3600000);
    }
    for (let i = 0; i < 20; i++) {
      insertConversationEvent(adapter, {
        kind: 'tool_use',
        timestamp: now - i * 60000,
      });
    }

    const result = generateRecent(adapter);
    expect(estimateTokens(result)).toBeLessThanOrEqual(1000);
  });

  // ── 10. Shows both episodic and conversation sections ────────────────

  it('shows both episodic sessions and conversation stats', () => {
    insertEpisodic(adapter, 'session-1', 'Some episodic event');
    insertConversationEvent(adapter, { kind: 'tool_use' });

    const result = generateRecent(adapter);

    expect(result).toContain('Session 1');
    expect(result).toContain('Conversation Activity');
  });
});
