import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import {
  handleProjectState,
  resetProjectStateGitCacheForTests,
} from '../../src/tools/project-state.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function commandWorks(command: string, args: string[], cwd: string): boolean {
  try {
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    });
    return true;
  } catch {
    return false;
  }
}

describe('handleProjectState', () => {
  let dir: string;
  let repo: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-project-state-'));
    repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'locus-memory', version: '3.7.0' }),
      'utf8',
    );
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    resetProjectStateGitCacheForTests();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('summarizes package metadata and memory freshness', () => {
    const ts = Date.parse('2026-05-30T10:00:00.000Z');
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'evt-1',
        'codex',
        null,
        normalizeProjectRootForScope(repo),
        'sess-1',
        ts,
        'session_end',
        '{"summary":"Track D planned."}',
        'high',
        null,
        ts,
      ],
    );

    const result = handleProjectState({ db, projectRoot: repo });

    expect(result).toMatchObject({
      projectRoot: normalizeProjectRootForScope(repo),
      projectHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      packageName: 'locus-memory',
      packageVersion: '3.7.0',
      activeDurableCount: 0,
      latestConversationTimestamp: ts,
      latestConversationIso: '2026-05-30T10:00:00.000Z',
      nextSteps: [],
      warnings: expect.not.arrayContaining(['No conversation events found for this project.']),
    });
  });

  it('reports injected git state and active durable next steps', () => {
    const ts = Date.parse('2026-05-30T10:00:00.000Z');
    db.run(
      `INSERT INTO durable_memories
       (topic_key, memory_type, state, summary, evidence_json, source_event_id, source, superseded_by_id, created_at, updated_at, project_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'track_d_memory_reliability',
        'next_step',
        'active',
        'Implement Track D project-scoped recall tests.',
        '{"source":"test"}',
        'evt-1',
        'codex',
        null,
        ts,
        ts,
        normalizeProjectRootForScope(repo),
      ],
    );

    const result = handleProjectState({
      db,
      projectRoot: repo,
      readGitState: () => ({ gitHead: 'abc1234', gitBranch: 'codex/track-d', dirty: true }),
    });

    expect(result).toMatchObject({
      gitHead: 'abc1234',
      gitBranch: 'codex/track-d',
      dirty: true,
      activeDurableCount: 1,
      nextSteps: ['Implement Track D project-scoped recall tests.'],
    });
  });

  it('reports a warning when git inspection is unavailable', () => {
    const result = handleProjectState({
      db,
      projectRoot: repo,
      readGitState: () => ({ unavailable: true }),
    });

    expect(result.warnings).toContain('Git state lookup failed; repo state may be incomplete.');
  });

  it('caches production git state briefly per project root', () => {
    if (!commandWorks('git', ['--version'], repo)) {
      return;
    }

    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repo,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['add', 'package.json'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo, stdio: 'ignore' });

    const first = handleProjectState({ db, projectRoot: repo });
    writeFileSync(join(repo, 'package.json'), '{}', 'utf8');
    const second = handleProjectState({ db, projectRoot: repo });

    expect(first.gitHead).toBeTruthy();
    expect(second.gitHead).toBe(first.gitHead);
    expect(first.dirty).toBe(false);
    expect(second.dirty).toBe(false);
  });
});
