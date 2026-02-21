import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EpisodicMemory } from '../../src/memory/episodic.js';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { generateDecisions } from '../../src/resources/decisions.js';
import { generateProjectMap } from '../../src/resources/project-map.js';
import { generateRecent } from '../../src/resources/recent.js';
import { type ScanDeps, scanProject } from '../../src/scanner/index.js';
import { initStorage, type StorageInit } from '../../src/storage/init.js';
import { ConfirmationTokenStore } from '../../src/tools/confirmation-token.js';
import { handleForget } from '../../src/tools/forget.js';
import { handlePurge } from '../../src/tools/purge.js';
import { handleRemember } from '../../src/tools/remember.js';
import { handleSearch } from '../../src/tools/search.js';
import type {
  DatabaseAdapter,
  ForgetResponseDeleted,
  ForgetResponsePending,
  PurgeResponseDone,
  PurgeResponsePending,
} from '../../src/types.js';
import { LOCUS_DEFAULTS, type LocusConfig } from '../../src/types.js';

// ─── Fixture file contents ────────────────────────────────────────────────────

const PACKAGE_JSON = `{ "name": "test-project", "version": "1.0.0", "type": "module" }`;

const SRC_INDEX_TS = `export function greetUser(name: string): string {
  return \`Hello, \${name}!\`;
}
export const APP_VERSION = '1.0.0';
`;

const SRC_UTILS_TS = `import { APP_VERSION } from './index.js';
export function formatVersion(): string {
  return \`v\${APP_VERSION}\`;
}
`;

const LIB_HELPER_PY = `def calculate_sum(a, b):
    return a + b

class MathHelper:
    pass
`;

// ─── Shared state (populated in beforeAll) ────────────────────────────────────

let tempDir: string;
let dbPath: string;
let storage: StorageInit;
let db: DatabaseAdapter;
let fts5: boolean;
let semantic: SemanticMemory;
let episodic: EpisodicMemory;
let purgeTokenStore: ConfirmationTokenStore;
let forgetTokenStore: ConfirmationTokenStore;

// ─── Mock ScanDeps: non-git project, findByMtime returns all fixture paths ────

const FIXTURE_FILES = ['package.json', 'src/index.ts', 'src/utils.ts', 'lib/helper.py'];

const mockScanDeps: ScanDeps = {
  isGitRepo: () => false,
  getHead: () => null,
  diffUnstaged: () => [],
  diffBetween: () => [],
  isAncestor: () => false,
  // Return the fixture file list so shouldFullRescan sees changed=4, total=0 → full scan
  findByMtime: () => FIXTURE_FILES,
  now: () => Math.floor(Date.now() / 1000),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('E2E: Full lifecycle', () => {
  beforeAll(async () => {
    // Create temp project directory with fixture files
    tempDir = mkdtempSync(join(tmpdir(), 'locus-e2e-'));

    writeFileSync(join(tempDir, 'package.json'), PACKAGE_JSON, 'utf-8');

    mkdirSync(join(tempDir, 'src'));
    writeFileSync(join(tempDir, 'src', 'index.ts'), SRC_INDEX_TS, 'utf-8');
    writeFileSync(join(tempDir, 'src', 'utils.ts'), SRC_UTILS_TS, 'utf-8');

    mkdirSync(join(tempDir, 'lib'));
    writeFileSync(join(tempDir, 'lib', 'helper.py'), LIB_HELPER_PY, 'utf-8');

    // Initialise storage
    dbPath = join(tempDir, 'locus.db');
    storage = await initStorage(dbPath);
    db = storage.db;
    fts5 = storage.fts5;

    // Initialise memory layers
    semantic = new SemanticMemory(db, fts5);
    episodic = new EpisodicMemory(db);

    // Initialise confirmation token stores
    purgeTokenStore = new ConfirmationTokenStore('purge');
    forgetTokenStore = new ConfirmationTokenStore('forget');
  });

  afterAll(() => {
    try {
      db.close();
    } catch {
      // already closed (e.g. after purge test)
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Test 1: scan ────────────────────────────────────────────────────────────

  it('scans fixture project and persists files to DB', async () => {
    const config: LocusConfig = { ...LOCUS_DEFAULTS, minScanInterval: 0 };

    const result = await scanProject(tempDir, db, config, mockScanDeps);

    // Strategy must be 'full' (changed=4, total=0 → shouldFullRescan=true)
    expect(result.strategy.type).toBe('full');

    // All 4 fixture files are walked; package.json is skipped (unsupported language)
    // src/index.ts, src/utils.ts, lib/helper.py are parsed
    expect(result.stats.scannedFiles).toBeGreaterThanOrEqual(3);

    // Verify rows are now in DB
    const fileCount = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM files');
    expect(fileCount?.cnt ?? 0).toBeGreaterThanOrEqual(3);
  });

  // ── Test 2: structural search for TypeScript export ─────────────────────────

  it('handleSearch finds exported function name from structural layer', () => {
    // greetUser is exported from src/index.ts
    const results = handleSearch('greetUser', { db, semantic, fts5 });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    expect(structural[0]?.content).toContain('greetUser');
    expect(structural[0]?.relevance).toBe(1.0);
  });

  // ── Test 3: structural search for Python export ─────────────────────────────

  it('handleSearch finds Python class from structural layer', () => {
    const results = handleSearch('MathHelper', { db, semantic, fts5 });

    const structural = results.filter((r) => r.layer === 'structural');
    expect(structural.length).toBeGreaterThan(0);
    expect(structural[0]?.content).toContain('MathHelper');
  });

  // ── Test 4: remember a decision ─────────────────────────────────────────────

  it('handleRemember persists a decision to semantic memory', () => {
    const entry = handleRemember(
      'Use greetUser for all greeting logic — avoids duplicating salutation formatting.',
      ['architecture', 'api'],
      { semantic },
    );

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.layer).toBe('semantic');
    expect(entry.content).toContain('greetUser');
    expect(entry.tags).toContain('architecture');

    // Count must now be 1
    expect(semantic.count()).toBe(1);
  });

  // ── Test 5: semantic search ──────────────────────────────────────────────────

  it('handleSearch finds the remembered decision in semantic layer', () => {
    const results = handleSearch('greetUser', { db, semantic, fts5 });

    const semanticResults = results.filter((r) => r.layer === 'semantic');
    expect(semanticResults.length).toBeGreaterThan(0);
    expect(semanticResults[0]?.content).toContain('greetUser');
    expect(semanticResults[0]?.relevance).toBe(0.8);
  });

  // ── Test 6: project-map resource ────────────────────────────────────────────

  it('generateProjectMap returns directory info within token budget', () => {
    const map = generateProjectMap(db, 'test-project');

    // Must mention the project name
    expect(map).toContain('test-project');
    // Must show scanned file count
    expect(map).toMatch(/\d+ scanned/);
    // Must mention src or lib directory
    expect(map).toMatch(/src\/|lib\//);
    // Token budget: rough check — less than ~8000 characters
    expect(map.length).toBeLessThan(8000);
  });

  // ── Test 7: decisions resource ──────────────────────────────────────────────

  it('generateDecisions contains the remembered decision', () => {
    const decisions = generateDecisions(db);

    expect(decisions).not.toBe('No decisions recorded yet.');
    expect(decisions).toContain('greetUser');
  });

  // ── Test 8: recent resource ─────────────────────────────────────────────────

  it('generateRecent returns a non-empty string (no sessions = placeholder)', () => {
    // We have no episodic events, so it should return the placeholder
    const recent = generateRecent(db);

    expect(typeof recent).toBe('string');
    expect(recent.length).toBeGreaterThan(0);
    // Either sessions exist OR the "no sessions" placeholder is shown
    expect(recent).toMatch(/No sessions recorded|Session \d/);
  });

  // ── Test 9: forget — immediate deletion for single entry ────────────────────

  it('handleForget deletes the remembered decision', () => {
    // count <= 5 → immediate deletion, no token needed
    const response = handleForget('greetUser', { semantic, tokenStore: forgetTokenStore });

    expect(response.status).toBe('deleted');
    const deleted = response as ForgetResponseDeleted;
    expect(deleted.deleted).toBe(1);

    // Confirm it is gone
    expect(semantic.count()).toBe(0);
  });

  // ── Test 10: forget — pending confirmation for bulk deletes ─────────────────

  it('handleForget requires confirmation token when more than 5 matches', () => {
    // Add 6 entries all mentioning the same keyword (no hyphens — FTS5 treats hyphens as minus)
    for (let i = 0; i < 6; i++) {
      semantic.add(`bulkmarker entry number ${i}`, ['bulk']);
    }
    expect(semantic.count()).toBe(6);

    // First call — no token → pending
    const pending = handleForget('bulkmarker', { semantic, tokenStore: forgetTokenStore });
    expect(pending.status).toBe('pending_confirmation');
    const pendingTyped = pending as ForgetResponsePending;
    expect(pendingTyped.matches).toBe(6);
    expect(pendingTyped.confirmToken).toMatch(/^forget-/);

    // Second call with the token → deleted
    const confirmed = handleForget(
      'bulkmarker',
      { semantic, tokenStore: forgetTokenStore },
      pendingTyped.confirmToken,
    );
    expect(confirmed.status).toBe('deleted');
    const confirmedTyped = confirmed as ForgetResponseDeleted;
    expect(confirmedTyped.deleted).toBe(6);

    expect(semantic.count()).toBe(0);
  });

  // ── Test 11: purge — two-call confirmation pattern ──────────────────────────

  it('handlePurge clears all data after two-call confirmation', async () => {
    // Add some data first so stats are non-zero
    semantic.add('pre-purge decision', ['test']);
    episodic.addEvent('pre-purge event', 'session-e2e-1');

    const beforeMemories = db.get<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM memories WHERE layer = 'semantic'",
    );
    expect(beforeMemories?.cnt ?? 0).toBeGreaterThan(0);

    // First call — no token → pending_confirmation
    const pending = handlePurge({ db, dbPath, projectPath: tempDir, tokenStore: purgeTokenStore });
    expect(pending.status).toBe('pending_confirmation');
    const pendingTyped = pending as PurgeResponsePending;
    expect(pendingTyped.confirmToken).toMatch(/^purge-/);
    expect(pendingTyped.stats.memories).toBeGreaterThan(0);

    // Second call — with valid token → purged
    const done = handlePurge(
      { db, dbPath, projectPath: tempDir, tokenStore: purgeTokenStore },
      pendingTyped.confirmToken,
    );
    expect(done.status).toBe('purged');
    const doneTyped = done as PurgeResponseDone;
    expect(doneTyped.clearedDbPath).toBe(dbPath);

    // All tables must now be empty
    const filesAfter = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM files');
    expect(filesAfter?.cnt ?? 0).toBe(0);

    const memoriesAfter = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM memories');
    expect(memoriesAfter?.cnt ?? 0).toBe(0);

    const scanStateAfter = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM scan_state');
    expect(scanStateAfter?.cnt ?? 0).toBe(0);
  });

  // ── Test 12: purge — invalid token returns error ─────────────────────────────

  it('handlePurge returns error for invalid confirmation token', () => {
    const response = handlePurge(
      { db, dbPath, projectPath: tempDir, tokenStore: purgeTokenStore },
      'purge-invalid-token',
    );
    expect(response.status).toBe('error');
  });
});
