import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleSearch, resolveTimeRange } from '../../src/tools/search.js';
import type { DatabaseAdapter, EventKind } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

// ─── Helper: insert a file row ────────────────────────────────────────────────

function insertFile(
  db: DatabaseAdapter,
  path: string,
  opts?: {
    exportsJson?: string;
    importsJson?: string;
  },
): void {
  db.run(
    `INSERT INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, ?, ?, '[]', 'module', 'typescript', 100, 'high', null, ?, null)`,
    [path, opts?.exportsJson ?? '[]', opts?.importsJson ?? '[]', Math.floor(Date.now() / 1000)],
  );
}

// ─── Helper: insert an episodic memory directly ───────────────────────────────

function insertEpisodic(db: DatabaseAdapter, content: string, sessionId: string): void {
  const now = Date.now();
  db.run(
    'INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES (?, ?, null, ?, ?, ?)',
    ['episodic', content, now, now, sessionId],
  );
}

function insertDurableMemory(
  db: DatabaseAdapter,
  opts: {
    summary: string;
    topicKey?: string;
    memoryType?: string;
    state?: string;
    source?: string;
    updatedAt?: number;
  },
): void {
  const now = opts.updatedAt ?? Date.now();
  db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.topicKey ?? null,
      opts.memoryType ?? 'decision',
      opts.state ?? 'active',
      opts.summary,
      JSON.stringify({ test: true }),
      null,
      opts.source ?? 'codex',
      null,
      now,
      now,
    ],
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('handleSearch', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-search-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
    semantic = new SemanticMemory(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Finds structural results by export name match ──────────────────────

  it('finds structural results by export name match', () => {
    insertFile(adapter, 'src/auth/login.ts', {
      exportsJson: JSON.stringify([
        { name: 'loginUser', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });

    const results = handleSearch('loginUser', { db: adapter, semantic, fts5: true });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    expect(structural[0]?.content).toContain('loginUser');
    expect(structural[0]?.relevance).toBe(1.0);
  });

  // ── 2. Finds structural results by file path match ────────────────────────

  it('finds structural results by file path match', () => {
    insertFile(adapter, 'src/auth/login.ts');
    insertFile(adapter, 'src/users/profile.ts');

    const results = handleSearch('auth', { db: adapter, semantic, fts5: true });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    const paths = structural.map((r) => r.content);
    expect(paths.some((p) => p.includes('auth'))).toBe(true);
  });

  // ── 3. Finds semantic results from SemanticMemory ─────────────────────────

  it('finds semantic results from SemanticMemory', () => {
    semantic.add('Use Zod for runtime validation', ['zod', 'validation']);
    semantic.add('Always write tests first', ['tdd']);

    const results = handleSearch('Zod', { db: adapter, semantic, fts5: true });

    const semanticResults = results.filter((r) => r.layer === 'semantic');
    expect(semanticResults.length).toBeGreaterThan(0);
    expect(semanticResults[0]?.content).toContain('Zod');
    expect(semanticResults[0]?.relevance).toBe(0.8);
    expect(semanticResults[0]?.source).toMatch(/^memory:\d+$/);
  });

  // ── 4. Finds episodic results from episodic entries ───────────────────────

  it('finds episodic results from episodic memories', () => {
    insertEpisodic(adapter, 'user asked about TypeScript configuration', 'session-abc');
    insertEpisodic(adapter, 'unrelated event log', 'session-abc');

    const results = handleSearch('TypeScript', { db: adapter, semantic, fts5: true });

    const episodic = results.filter((r) => r.layer === 'episodic');
    expect(episodic.length).toBeGreaterThan(0);
    expect(episodic[0]?.content).toContain('TypeScript');
    expect(episodic[0]?.relevance).toBe(0.6);
    expect(episodic[0]?.source).toContain('session:');
  });

  // ── 5. Returns results sorted by relevance DESC ───────────────────────────

  it('returns results sorted by relevance DESC', () => {
    // Export match (1.0) + semantic (0.8) + episodic (0.6) + path match (0.5)
    insertFile(adapter, 'src/search-module/index.ts', {
      exportsJson: JSON.stringify([
        { name: 'searchItems', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });
    semantic.add('search strategy decisions', []);
    insertEpisodic(adapter, 'searched for search functionality', 'session-1');

    const results = handleSearch('search', { db: adapter, semantic, fts5: true });

    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]?.relevance).toBeGreaterThanOrEqual(results[i]?.relevance ?? 0);
    }
  });

  // ── 6. Returns empty array for no matches ─────────────────────────────────

  it('returns empty array when nothing matches the query', () => {
    insertFile(adapter, 'src/auth/login.ts');
    semantic.add('Use Zod for validation', []);
    insertEpisodic(adapter, 'some event', 'session-1');

    const results = handleSearch('xyznonexistentquery123', { db: adapter, semantic, fts5: true });

    expect(results).toEqual([]);
  });

  // ── 7. Limits total results to 20 ────────────────────────────────────────

  it('limits total results to 20', () => {
    // Insert 15 files each with a matching export
    for (let i = 0; i < 15; i++) {
      insertFile(adapter, `src/module${i}/index.ts`, {
        exportsJson: JSON.stringify([
          { name: `targetFunc${i}`, kind: 'function', isDefault: false, isTypeOnly: false },
        ]),
      });
    }
    // Insert 10 semantic memories
    for (let i = 0; i < 10; i++) {
      semantic.add(`target decision number ${i}`, []);
    }
    // Insert 5 episodic entries
    for (let i = 0; i < 5; i++) {
      insertEpisodic(adapter, `target episodic event ${i}`, 'session-bulk');
    }

    const results = handleSearch('target', { db: adapter, semantic, fts5: true });

    expect(results.length).toBeLessThanOrEqual(20);
  });

  // ── 8. Export name match has higher relevance than path match ─────────────

  it('export name match has higher relevance than path match', () => {
    // File with matching export name
    insertFile(adapter, 'src/api/users.ts', {
      exportsJson: JSON.stringify([
        { name: 'getUser', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });
    // File with matching path only (no export match)
    insertFile(adapter, 'src/getUser-helper/utils.ts');

    const results = handleSearch('getUser', { db: adapter, semantic, fts5: true });

    const exportMatch = results.find((r) => r.layer === 'structural' && r.relevance === 1.0);
    const pathMatch = results.find((r) => r.layer === 'structural' && r.relevance === 0.5);

    expect(exportMatch).toBeDefined();
    expect(pathMatch).toBeDefined();
    expect((exportMatch?.relevance ?? 0) > (pathMatch?.relevance ?? 1)).toBe(true);
  });

  // ── Additional: episodic source includes session_id ───────────────────────

  it('episodic results include the correct session_id in source', () => {
    insertEpisodic(adapter, 'user ran the deploy command', 'session-deploy-42');

    const results = handleSearch('deploy', { db: adapter, semantic, fts5: true });

    const episodic = results.filter((r) => r.layer === 'episodic');
    expect(episodic.length).toBe(1);
    expect(episodic[0]?.source).toBe('session:session-deploy-42');
  });

  // ── Additional: structural path match content is the file path ────────────

  it('structural path match content is the file path itself', () => {
    insertFile(adapter, 'src/authentication/session.ts');

    const results = handleSearch('authentication', { db: adapter, semantic, fts5: true });

    const pathMatch = results.find((r) => r.layer === 'structural' && r.relevance === 0.5);
    expect(pathMatch?.content).toBe('src/authentication/session.ts');
  });

  it('returns durable results as a first-class layer', () => {
    insertDurableMemory(adapter, {
      topicKey: 'database_choice',
      summary: 'Use SQLite for the local durable memory store.',
    });

    const results = handleSearch('SQLite', { db: adapter, semantic, fts5: true });

    const durable = results.filter((r) => r.layer === 'durable');
    expect(durable.length).toBeGreaterThan(0);
    expect(durable[0]?.content).toContain('SQLite');
    expect(durable[0]?.source).toMatch(/^durable:\d+$/);
  });

  it('ranks durable hits above generic semantic hits for the same query', () => {
    insertDurableMemory(adapter, {
      topicKey: 'database_choice',
      summary: 'Use SQLite for the local durable memory store.',
    });
    semantic.add('SQLite note saved in legacy semantic memory', ['sqlite']);

    const results = handleSearch('SQLite', { db: adapter, semantic, fts5: true });
    const durableIndex = results.findIndex((r) => r.layer === 'durable');
    const semanticIndex = results.findIndex((r) => r.layer === 'semantic');

    expect(durableIndex).toBeGreaterThanOrEqual(0);
    expect(semanticIndex).toBeGreaterThanOrEqual(0);
    expect(durableIndex).toBeLessThan(semanticIndex);
  });
});

// ─── Conversation Event Helpers ────────────────────────────────────────────

let ceCounter = 0;

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: {
    event_id?: string;
    kind?: EventKind;
    timestamp?: number;
    payload_json?: string;
    significance?: string;
    session_id?: string;
    source?: string;
    project_root?: string;
  },
): number {
  ceCounter++;
  const eventId = opts.event_id ?? `evt-${ceCounter}-${Date.now()}`;
  const result = db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      opts.source ?? 'test',
      null,
      opts.project_root ?? '/test/project',
      opts.session_id ?? 'test-session',
      opts.timestamp ?? Date.now(),
      opts.kind ?? 'tool_use',
      opts.payload_json ?? '{"tool":"Read","files":["src/test.ts"],"status":"success"}',
      opts.significance ?? 'medium',
      null,
      Date.now(),
    ],
  );
  return result.lastInsertRowid;
}

function insertConversationFts(db: DatabaseAdapter, rowid: number, content: string): void {
  db.run('INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)', [rowid, content]);
}

function insertEventFile(db: DatabaseAdapter, eventId: string, filePath: string): void {
  db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [eventId, filePath]);
}

// ─── Conversation Search Tests ─────────────────────────────────────────────

describe('handleSearch — conversation events', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  let semantic: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-search-conv-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
    semantic = new SemanticMemory(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Finds conversation events by FTS query ───────────────────────────

  it('finds conversation events by FTS query', () => {
    const rowid = insertConversationEvent(adapter, {
      kind: 'tool_use',
      payload_json: '{"tool":"Write","files":["src/auth.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid, 'tool_use Write src/auth.ts');

    const results = handleSearch('Write', { db: adapter, semantic, fts5: true });

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBeGreaterThan(0);
    expect(conv[0]?.content).toContain('Write');
  });

  // ── 2. Filters by timeRange.relative ─────────────────────────────────────

  it('filters by timeRange.relative=today', () => {
    const now = Date.now();
    const todayRowid = insertConversationEvent(adapter, {
      event_id: 'evt-today',
      kind: 'tool_use',
      timestamp: now,
      payload_json: '{"tool":"Edit","files":["src/today.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, todayRowid, 'tool_use Edit src/today.ts');

    const oldRowid = insertConversationEvent(adapter, {
      event_id: 'evt-old',
      kind: 'tool_use',
      timestamp: now - 7 * 86400 * 1000,
      payload_json: '{"tool":"Edit","files":["src/old.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, oldRowid, 'tool_use Edit src/old.ts');

    const results = handleSearch(
      'Edit',
      { db: adapter, semantic, fts5: true },
      {
        timeRange: { relative: 'today' },
      },
    );

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBe(1);
    expect(conv[0]?.content).toContain('today.ts');
  });

  // ── 3. Filters by filePath via event_files JOIN ─────────────────────────

  it('filters by filePath via event_files JOIN', () => {
    const rowid1 = insertConversationEvent(adapter, {
      event_id: 'evt-auth',
      kind: 'tool_use',
      payload_json: '{"tool":"Write","files":["src/auth.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid1, 'tool_use Write src/auth.ts');
    insertEventFile(adapter, 'evt-auth', 'src/auth.ts');

    const rowid2 = insertConversationEvent(adapter, {
      event_id: 'evt-utils',
      kind: 'tool_use',
      payload_json: '{"tool":"Write","files":["src/utils.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid2, 'tool_use Write src/utils.ts');
    insertEventFile(adapter, 'evt-utils', 'src/utils.ts');

    const results = handleSearch(
      'Write',
      { db: adapter, semantic, fts5: true },
      {
        filePath: 'src/auth.ts',
      },
    );

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBe(1);
    expect(conv[0]?.content).toContain('auth.ts');
  });

  // ── 4. Filters by kind ──────────────────────────────────────────────────

  it('filters by kind', () => {
    const rowid1 = insertConversationEvent(adapter, {
      event_id: 'evt-tool',
      kind: 'tool_use',
      payload_json: '{"tool":"Read","files":["f.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid1, 'tool_use Read f.ts');

    const rowid2 = insertConversationEvent(adapter, {
      event_id: 'evt-prompt',
      kind: 'user_prompt',
      payload_json: '{"prompt":"Read the configuration"}',
    });
    insertConversationFts(adapter, rowid2, 'user_prompt Read the configuration');

    const results = handleSearch(
      'Read',
      { db: adapter, semantic, fts5: true },
      {
        kind: 'tool_use',
      },
    );

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBe(1);
    expect(conv[0]?.source).toContain('tool_use');
  });

  // ── 5. Combines multiple filters ────────────────────────────────────────

  it('combines multiple filters', () => {
    const now = Date.now();

    const rowid1 = insertConversationEvent(adapter, {
      event_id: 'evt-match',
      kind: 'tool_use',
      timestamp: now,
      payload_json: '{"tool":"Write","files":["src/target.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid1, 'tool_use Write src/target.ts');
    insertEventFile(adapter, 'evt-match', 'src/target.ts');

    const rowid2 = insertConversationEvent(adapter, {
      event_id: 'evt-wrong-kind',
      kind: 'user_prompt',
      timestamp: now,
      payload_json: '{"prompt":"Write something about target"}',
    });
    insertConversationFts(adapter, rowid2, 'user_prompt Write something about target');

    const rowid3 = insertConversationEvent(adapter, {
      event_id: 'evt-wrong-file',
      kind: 'tool_use',
      timestamp: now,
      payload_json: '{"tool":"Write","files":["src/other.ts"],"status":"success"}',
    });
    insertConversationFts(adapter, rowid3, 'tool_use Write src/other.ts');
    insertEventFile(adapter, 'evt-wrong-file', 'src/other.ts');

    const results = handleSearch(
      'Write',
      { db: adapter, semantic, fts5: true },
      {
        kind: 'tool_use',
        filePath: 'src/target.ts',
      },
    );

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBe(1);
    expect(conv[0]?.content).toContain('target.ts');
  });

  // ── 6. Backwards compat — query-only works ──────────────────────────────

  it('backwards compat: query-only works with no options', () => {
    insertFile(adapter, 'src/legacy.ts', {
      exportsJson: JSON.stringify([
        { name: 'legacyFunction', kind: 'function', isDefault: false, isTypeOnly: false },
      ]),
    });

    const results = handleSearch('legacyFunction', { db: adapter, semantic, fts5: true });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.layer).toBe('structural');
  });

  // ── 7. bm25 + recency scoring ──────────────────────────────────────────

  it('conversation results have positive relevance scores', () => {
    const now = Date.now();
    const rowid = insertConversationEvent(adapter, {
      kind: 'tool_use',
      timestamp: now,
      payload_json: '{"tool":"Bash","files":[],"status":"success"}',
    });
    insertConversationFts(adapter, rowid, 'tool_use Bash execute command');

    const results = handleSearch('Bash', { db: adapter, semantic, fts5: true });

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBeGreaterThan(0);
    expect(conv[0]?.relevance).toBeGreaterThan(0);
  });

  // ── 8. LIKE fallback when fts5=false ────────────────────────────────────

  it('LIKE fallback when fts5 is false', () => {
    insertConversationEvent(adapter, {
      kind: 'tool_use',
      payload_json: '{"tool":"Grep","files":["src/search.ts"],"status":"success"}',
    });

    const results = handleSearch('Grep', { db: adapter, semantic, fts5: false });

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBeGreaterThan(0);
    expect(conv[0]?.content).toContain('Grep');
  });

  // ── 9. Respects limit and offset ───────────────────────────────────────

  it('respects limit param', () => {
    for (let i = 0; i < 5; i++) {
      const rowid = insertConversationEvent(adapter, {
        event_id: `evt-lim-${i}`,
        kind: 'tool_use',
        payload_json: `{"tool":"Read","files":["src/file${i}.ts"],"status":"success"}`,
      });
      insertConversationFts(adapter, rowid, `tool_use Read src/file${i}.ts`);
    }

    const results = handleSearch(
      'Read',
      { db: adapter, semantic, fts5: true },
      {
        limit: 2,
      },
    );

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBeLessThanOrEqual(2);
  });

  // ── 10. source field in results ────────────────────────────────────────

  it('result source contains event kind and event_id', () => {
    const rowid = insertConversationEvent(adapter, {
      event_id: 'evt-source-test',
      kind: 'file_diff',
      payload_json: '{"path":"src/module","added":10,"removed":2}',
    });
    insertConversationFts(adapter, rowid, 'file_diff src module changes');

    const results = handleSearch('module', { db: adapter, semantic, fts5: true });

    const conv = results.filter((r) => r.layer === 'conversation');
    expect(conv.length).toBeGreaterThan(0);
    expect(conv[0]?.source).toContain('evt-source-test');
  });
});

// ─── resolveTimeRange Tests ───────────────────────────────────────────────

describe('resolveTimeRange', () => {
  it('resolves "today" to start of current day', () => {
    const range = resolveTimeRange({ relative: 'today' });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    expect(range.from).toBe(startOfDay.getTime());
    expect(range.to).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it('resolves "yesterday" to the previous day boundaries', () => {
    const range = resolveTimeRange({ relative: 'yesterday' });
    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);

    expect(range.from).toBe(startOfYesterday.getTime());
    // to should be end of yesterday (start of today)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    expect(range.to).toBe(startOfToday.getTime());
  });

  it('resolves "last_7d" to 7 days back', () => {
    const before = Date.now();
    const range = resolveTimeRange({ relative: 'last_7d' });
    const after = Date.now();

    const sevenDaysMs = 7 * 24 * 3600 * 1000;
    expect(range.from).toBeGreaterThanOrEqual(before - sevenDaysMs);
    expect(range.from).toBeLessThanOrEqual(after - sevenDaysMs + 100);
    expect(range.to).toBeGreaterThanOrEqual(before);
  });

  it('resolves "last_30d" to 30 days back', () => {
    const before = Date.now();
    const range = resolveTimeRange({ relative: 'last_30d' });

    const thirtyDaysMs = 30 * 24 * 3600 * 1000;
    expect(range.from).toBeGreaterThanOrEqual(before - thirtyDaysMs - 100);
    expect(range.to).toBeGreaterThanOrEqual(before);
  });

  it('passes through absolute from/to', () => {
    const range = resolveTimeRange({ from: 1000, to: 2000 });
    expect(range.from).toBe(1000);
    expect(range.to).toBe(2000);
  });

  it('resolves "this_week" to Monday start', () => {
    const range = resolveTimeRange({ relative: 'this_week' });
    const monday = new Date();
    const dayOfWeek = monday.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(monday.getDate() - diff);
    monday.setHours(0, 0, 0, 0);

    expect(range.from).toBe(monday.getTime());
    expect(range.to).toBeGreaterThanOrEqual(Date.now() - 1000);
  });
});
