import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleStatus, type StatusDeps } from '../../src/tools/status.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

/** Build a minimal StatusDeps with sane defaults, overridable per test. */
function makeStatusDeps(
  adapter: NodeSqliteAdapter,
  tempDir: string,
  overrides: Partial<StatusDeps> = {},
): StatusDeps {
  return {
    projectPath: '/project/path',
    projectRoot: '/project/root',
    projectRootMethod: 'git-root',
    dbPath: join(tempDir, 'test.db'),
    db: adapter,
    config: LOCUS_DEFAULTS,
    backend: 'node:sqlite',
    fts5: true,
    ...overrides,
  };
}

describe('handleStatus', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-status-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns correct totalFiles count from the files table', () => {
    // Insert 3 file rows
    for (const path of ['src/a.ts', 'src/b.ts', 'src/c.ts']) {
      adapter.run(
        `INSERT INTO files
          (relative_path, exports_json, imports_json, re_exports_json,
           file_type, language, lines, confidence_level, last_scanned)
         VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', ?)`,
        [path, Math.floor(Date.now() / 1000)],
      );
    }

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.totalFiles).toBe(3);
  });

  it('returns correct totalMemories count for semantic layer', () => {
    const now = Math.floor(Date.now() / 1000);
    // 2 semantic, 1 episodic — only semantic should be counted
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', 'Decision A', '[]', now, now],
    );
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', 'Decision B', '[]', now, now],
    );
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Session note', '[]', now, now],
    );

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.totalMemories).toBe(2);
  });

  it('returns correct totalEpisodes count for episodic layer', () => {
    const now = Math.floor(Date.now() / 1000);
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Episode 1', '[]', now, now],
    );
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['episodic', 'Episode 2', '[]', now, now],
    );
    adapter.run(
      'INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['semantic', 'Semantic one', '[]', now, now],
    );

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.totalEpisodes).toBe(2);
  });

  it('returns correct lastScan value from scan_state table', () => {
    const expectedTs = 1700000000;
    adapter.run("INSERT OR REPLACE INTO scan_state (key, value) VALUES ('lastScan', ?)", [
      String(expectedTs),
    ]);

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.lastScan).toBe(expectedTs);
  });

  it('returns lastScan=0 when scan_state has no lastScan entry', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir));
    expect(status.lastScan).toBe(0);
  });

  it('returns 0 for dbSizeBytes when db file does not exist', () => {
    const status = handleStatus(
      makeStatusDeps(adapter, tempDir, {
        dbPath: '/nonexistent/path/does-not-exist.db',
      }),
    );

    expect(status.dbSizeBytes).toBe(0);
  });

  it('returns a positive dbSizeBytes when db file exists', () => {
    // The adapter created the file at join(tempDir, 'test.db')
    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.dbSizeBytes).toBeGreaterThan(0);
  });

  it('returns all static config fields correctly', () => {
    const status = handleStatus(
      makeStatusDeps(adapter, tempDir, {
        projectPath: '/my/project',
        projectRoot: '/my/root',
        projectRootMethod: 'project-marker',
        backend: 'sql.js',
        fts5: false,
        config: { ...LOCUS_DEFAULTS, captureLevel: 'redacted' },
      }),
    );

    expect(status.projectPath).toBe('/my/project');
    expect(status.projectRoot).toBe('/my/root');
    expect(status.projectRootMethod).toBe('project-marker');
    expect(status.storageBackend).toBe('sql.js');
    expect(status.fts5Available).toBe(false);
    expect(status.captureLevel).toBe('redacted');
    expect(status.nodeVersion).toBe(process.version);
  });

  it('returns scanStrategy from scan_state lastStrategy, defaulting to unknown', () => {
    // Without a lastStrategy entry, should be 'unknown'
    const statusBefore = handleStatus(makeStatusDeps(adapter, tempDir));
    expect(statusBefore.scanStrategy).toBe('unknown');

    // Insert a lastStrategy value
    adapter.run("INSERT OR REPLACE INTO scan_state (key, value) VALUES ('lastStrategy', ?)", [
      'full',
    ]);

    const statusAfter = handleStatus(makeStatusDeps(adapter, tempDir));
    expect(statusAfter.scanStrategy).toBe('full');
  });

  it('reports searchEngine as FTS5 when available', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir, { fts5: true }));
    expect(status.searchEngine).toBe('FTS5');
  });

  it('reports searchEngine as LIKE fallback when FTS5 unavailable', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir, { fts5: false }));
    expect(status.searchEngine).toBe('LIKE fallback');
  });

  it('skippedFiles counts only rows with non-null skipped_reason', () => {
    const now = Math.floor(Date.now() / 1000);
    // 2 normal files, 1 skipped
    adapter.run(
      `INSERT INTO files
        (relative_path, exports_json, imports_json, re_exports_json,
         file_type, language, lines, confidence_level, last_scanned, skipped_reason)
       VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', ?, NULL)`,
      ['src/a.ts', now],
    );
    adapter.run(
      `INSERT INTO files
        (relative_path, exports_json, imports_json, re_exports_json,
         file_type, language, lines, confidence_level, last_scanned, skipped_reason)
       VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', ?, NULL)`,
      ['src/b.ts', now],
    );
    adapter.run(
      `INSERT INTO files
        (relative_path, exports_json, imports_json, re_exports_json,
         file_type, language, lines, confidence_level, last_scanned, skipped_reason)
       VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', ?, 'binary')`,
      ['src/c.bin', now],
    );

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.totalFiles).toBe(3);
    expect(status.skippedFiles).toBe(1);
  });

  // ── Conversation events count ───────────────────────────────────────────

  it('returns totalConversationEvents count from conversation_events table', () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      adapter.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id,
          timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt-status-${i}`,
          'test',
          null,
          '/test',
          'session-1',
          now,
          'tool_use',
          '{}',
          'medium',
          null,
          now,
        ],
      );
    }

    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.totalConversationEvents).toBe(3);
  });

  it('returns totalConversationEvents=0 when no events exist', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir));
    expect(status.totalConversationEvents).toBe(0);
  });

  // ── Inbox pending count ───────────────────────────────────────────────────

  it('returns inboxPending count of JSON files in inboxDir', () => {
    const inboxDir = join(tempDir, 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, '001-abc.json'), '{}');
    writeFileSync(join(inboxDir, '002-def.json'), '{}');
    writeFileSync(join(inboxDir, '003-ghi.tmp'), '{}'); // not .json

    const status = handleStatus(makeStatusDeps(adapter, tempDir, { inboxDir }));

    expect(status.inboxPending).toBe(2);
  });

  it('returns inboxPending=0 when inboxDir does not exist', () => {
    const status = handleStatus(
      makeStatusDeps(adapter, tempDir, { inboxDir: '/nonexistent/inbox/dir' }),
    );
    expect(status.inboxPending).toBe(0);
  });

  it('returns inboxPending=0 when inboxDir is not provided', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir));
    expect(status.inboxPending).toBe(0);
  });

  it('exposes a codexAutoImport snapshot with a stable default shape', () => {
    const status = handleStatus(makeStatusDeps(adapter, tempDir));

    expect(status.codexAutoImport).toEqual({
      clientDetected: false,
      client: 'generic',
      clientSurface: 'generic',
      detectionEvidence: [],
      debounceMs: 45000,
      lastStatus: 'idle',
      lastImported: 0,
      lastDuplicates: 0,
      lastErrors: 0,
    });
  });

  it('returns the latest codexAutoImport snapshot when provided by the server', () => {
    const status = handleStatus(
      makeStatusDeps(adapter, tempDir, {
        codexAutoImportSnapshot: {
          clientDetected: true,
          client: 'codex',
          clientSurface: 'cli',
          detectionEvidence: ['env:CODEX_HOME'],
          debounceMs: 45000,
          lastStatus: 'imported',
          lastAttemptAt: 1700000000000,
          lastRunAt: 1700000000500,
          lastImported: 4,
          lastDuplicates: 1,
          lastErrors: 0,
          latestSession: 'session-123',
          message: 'Imported latest Codex session',
        },
      }),
    );

    expect(status.codexAutoImport).toEqual({
      clientDetected: true,
      client: 'codex',
      clientSurface: 'cli',
      detectionEvidence: ['env:CODEX_HOME'],
      debounceMs: 45000,
      lastStatus: 'imported',
      lastAttemptAt: 1700000000000,
      lastRunAt: 1700000000500,
      lastImported: 4,
      lastDuplicates: 1,
      lastErrors: 0,
      latestSession: 'session-123',
      message: 'Imported latest Codex session',
    });
  });

  it('exposes Codex diagnostics when the server provides a Codex snapshot', () => {
    const status = handleStatus({
      ...(makeStatusDeps(adapter, tempDir) as object),
      codexDiagnostics: {
        client: 'codex',
        clientSurface: 'cli',
        detectionEvidence: ['env:CODEX_HOME'],
        captureMode: 'metadata',
        sessionsDir: '/codex/sessions',
        sessionsDirExists: true,
        rolloutFilesFound: 3,
        latestRolloutPath: '/codex/sessions/2026/04/rollout-2026-04-14T12-00-00.jsonl',
        latestRolloutReadable: true,
        importedEventCount: 4,
        latestImportedSessionId: 'session-123',
        latestImportedTimestamp: 1700000000000,
      },
    } as never);

    expect((status as Record<string, unknown>).codexDiagnostics).toEqual({
      client: 'codex',
      clientSurface: 'cli',
      detectionEvidence: ['env:CODEX_HOME'],
      captureMode: 'metadata',
      sessionsDir: '/codex/sessions',
      sessionsDirExists: true,
      rolloutFilesFound: 3,
      latestRolloutPath: '/codex/sessions/2026/04/rollout-2026-04-14T12-00-00.jsonl',
      latestRolloutReadable: true,
      importedEventCount: 4,
      latestImportedSessionId: 'session-123',
      latestImportedTimestamp: 1700000000000,
    });
  });
});
