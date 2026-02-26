import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { ConfirmationTokenStore } from '../../src/tools/confirmation-token.js';
import type { PurgeDeps } from '../../src/tools/purge.js';
import { handlePurge } from '../../src/tools/purge.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

/** Seed the DB with deterministic data for stat assertions. */
function seedData(adapter: NodeSqliteAdapter): void {
  // 2 files
  adapter.run(
    `INSERT INTO files (relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, last_scanned)
     VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 10, 'high', ?)`,
    ['src/foo.ts', Date.now()],
  );
  adapter.run(
    `INSERT INTO files (relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines, confidence_level, last_scanned)
     VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 20, 'high', ?)`,
    ['src/bar.ts', Date.now()],
  );

  // 3 semantic memories
  for (let i = 0; i < 3; i++) {
    const now = Date.now();
    adapter.run(
      `INSERT INTO memories (layer, content, tags_json, created_at, updated_at)
       VALUES ('semantic', ?, '[]', ?, ?)`,
      [`Decision ${i}`, now, now],
    );
  }

  // 2 episodic memories
  for (let i = 0; i < 2; i++) {
    const now = Date.now();
    adapter.run(
      `INSERT INTO memories (layer, content, tags_json, created_at, updated_at)
       VALUES ('episodic', ?, '[]', ?, ?)`,
      [`Episode ${i}`, now, now],
    );
  }

  // 1 scan_state entry
  adapter.run("INSERT INTO scan_state (key, value) VALUES ('lastScan', '12345')");

  // 1 hook_capture entry
  adapter.run(
    `INSERT INTO hook_captures (tool_name, file_paths_json, status, timestamp, duration_ms)
     VALUES ('Write', '[]', 'success', ?, 50)`,
    [Date.now()],
  );
}

describe('handlePurge', () => {
  let tempDir: string;
  let dbPath: string;
  let adapter: NodeSqliteAdapter;
  let tokenStore: ConfirmationTokenStore;
  let deps: PurgeDeps;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-purge-'));
    dbPath = join(tempDir, 'test.db');
    adapter = createAdapter(tempDir);
    runMigrations(adapter, false);
    tokenStore = new ConfirmationTokenStore('purge');
    deps = { db: adapter, dbPath, projectPath: '/my/project', tokenStore };
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Test 1: First call without token returns pending_confirmation ─────────

  it('first call without token returns pending_confirmation', () => {
    seedData(adapter);

    const result = handlePurge(deps);

    expect(result.status).toBe('pending_confirmation');
  });

  // ── Test 2: Pending response includes correct file/memory/episode counts ──

  it('pending response includes correct file/memory/episode counts', () => {
    seedData(adapter);

    const result = handlePurge(deps);

    expect(result.status).toBe('pending_confirmation');
    if (result.status !== 'pending_confirmation') return;

    expect(result.stats.files).toBe(2);
    expect(result.stats.memories).toBe(3);
    expect(result.stats.episodes).toBe(2);
    expect(result.stats.dbSizeBytes).toBeGreaterThan(0);
  });

  // ── Test 3: Token format matches /^purge-[0-9a-f]{8}$/ ───────────────────

  it('token format matches /^purge-[0-9a-f]{8}$/', () => {
    const result = handlePurge(deps);

    expect(result.status).toBe('pending_confirmation');
    if (result.status !== 'pending_confirmation') return;

    expect(result.confirmToken).toMatch(/^purge-[0-9a-f]{8}$/);
  });

  // ── Test 4: Second call with valid token purges all data and returns done ─

  it('second call with valid token purges all data and returns done', () => {
    seedData(adapter);

    const pending = handlePurge(deps);
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    const result = handlePurge(deps, pending.confirmToken);

    expect(result.status).toBe('purged');
  });

  // ── Test 5: After purge, all tables are empty ─────────────────────────────

  it('after purge, all tables are empty (files, memories, hook_captures, scan_state)', () => {
    seedData(adapter);

    const pending = handlePurge(deps);
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    handlePurge(deps, pending.confirmToken);

    interface CntRow {
      cnt: number;
    }
    const fileCount = adapter.get<CntRow>('SELECT COUNT(*) AS cnt FROM files')?.cnt ?? -1;
    const memCount = adapter.get<CntRow>('SELECT COUNT(*) AS cnt FROM memories')?.cnt ?? -1;
    const hookCount = adapter.get<CntRow>('SELECT COUNT(*) AS cnt FROM hook_captures')?.cnt ?? -1;
    const scanCount = adapter.get<CntRow>('SELECT COUNT(*) AS cnt FROM scan_state')?.cnt ?? -1;

    expect(fileCount).toBe(0);
    expect(memCount).toBe(0);
    expect(hookCount).toBe(0);
    expect(scanCount).toBe(0);
  });

  // ── Test 6: Rejects invalid token with error status ───────────────────────

  it('rejects invalid token with error status', () => {
    const result = handlePurge(deps, 'purge-00000000');

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Invalid or expired');
    }
  });

  // ── Test 7: Rejects reused token (single-use) ─────────────────────────────

  it('rejects reused token — token is single-use', () => {
    const pending = handlePurge(deps);
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    const { confirmToken } = pending;

    // First use — valid
    const first = handlePurge(deps, confirmToken);
    expect(first.status).toBe('purged');

    // Seed again so file/memory counts are non-zero for the second call
    runMigrations(adapter, false);
    seedData(adapter);

    // Second use — must fail
    const second = handlePurge(deps, confirmToken);
    expect(second.status).toBe('error');
    if (second.status === 'error') {
      expect(second.message).toContain('Invalid or expired');
    }
  });

  // ── Test 8: Rejects expired token ─────────────────────────────────────────

  it('rejects expired token', () => {
    const shortStore = new ConfirmationTokenStore('purge', 1000);
    const pastNow = Date.now() - 2000; // 2 seconds ago
    const expiredToken = shortStore.generate(pastNow);

    const localDeps: PurgeDeps = { ...deps, tokenStore: shortStore };
    const result = handlePurge(localDeps, expiredToken);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Invalid or expired');
    }
  });

  // ── Test 9: PurgeResponseDone includes correct dbPath ────────────────────

  it('PurgeResponseDone includes correct clearedDbPath', () => {
    const pending = handlePurge(deps);
    expect(pending.status).toBe('pending_confirmation');
    if (pending.status !== 'pending_confirmation') return;

    const result = handlePurge(deps, pending.confirmToken);

    expect(result.status).toBe('purged');
    if (result.status === 'purged') {
      expect(result.clearedDbPath).toBe(dbPath);
      expect(result.message).toContain('preserved');
      expect(result.message).toContain(dbPath);
    }
  });
});
