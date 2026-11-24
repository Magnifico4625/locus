import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionStartBrief } from '../../src/context/auto-brief.js';
import {
  formatLocalDateKey,
  listRecentDailySummaries,
  syncDailyJournal,
} from '../../src/memory/daily-journal.js';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleCalendar } from '../../src/tools/calendar.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function insertEvent(
  db: NodeSqliteAdapter,
  opts: {
    eventId: string;
    projectRoot: string;
    sessionId: string;
    timestamp: number;
    kind: 'user_prompt' | 'ai_response' | 'tool_use' | 'session_end';
    payload: Record<string, unknown>;
    files?: string[];
  },
): void {
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      'codex',
      null,
      opts.projectRoot,
      opts.sessionId,
      opts.timestamp,
      opts.kind,
      JSON.stringify(opts.payload),
      'high',
      '[]',
      opts.timestamp,
    ],
  );
  for (const filePath of opts.files ?? []) {
    db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [opts.eventId, filePath]);
  }
}

describe('Daily Memory Library (daily-journal)', () => {
  let tempDir: string;
  let projectDir: string;
  let otherDir: string;
  let journalDir: string;
  let db: NodeSqliteAdapter;
  let store: DurableMemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-daily-journal-'));
    projectDir = join(tempDir, 'my-project');
    otherDir = join(tempDir, 'other-project');
    journalDir = join(tempDir, 'journal');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    db = createAdapter(tempDir);
    runMigrations(db, true);
    store = new DurableMemoryStore(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('syncs project-scoped daily summaries to SQLite and atomic Markdown files without temp leftovers', () => {
    const scopedProject = normalizeProjectRootForScope(projectDir);
    const scopedOther = normalizeProjectRootForScope(otherDir);

    const yesterday = new Date(2026, 10, 23, 14, 0, 0).getTime();
    const today = new Date(2026, 10, 24, 11, 30, 0).getTime();
    const yesterdayKey = formatLocalDateKey(yesterday);
    const todayKey = formatLocalDateKey(today);

    const d1 = store.insert({
      topicKey: 'database_choice',
      memoryType: 'decision',
      summary: 'Use SQLite WAL with daily summaries.',
      evidence: { confidence: 0.9 },
      projectRoot: scopedProject,
      source: 'codex',
    });
    db.run('UPDATE durable_memories SET created_at = ?, updated_at = ? WHERE id = ?', [
      yesterday,
      yesterday,
      d1.id,
    ]);
    const dOther = store.insert({
      topicKey: 'other_decision',
      memoryType: 'decision',
      summary: 'Secret other project decision.',
      evidence: { confidence: 0.9 },
      projectRoot: scopedOther,
      source: 'codex',
    });
    db.run('UPDATE durable_memories SET created_at = ?, updated_at = ? WHERE id = ?', [
      today,
      today,
      dOther.id,
    ]);

    insertEvent(db, {
      eventId: 'evt-y1',
      projectRoot: scopedProject,
      sessionId: 'sess-y1',
      timestamp: yesterday,
      kind: 'user_prompt',
      payload: { prompt: 'Implemented WAL checkpoint strategy.' },
      files: ['packages/core/src/tools/compact.ts'],
    });
    insertEvent(db, {
      eventId: 'evt-y-echo',
      projectRoot: scopedProject,
      sessionId: 'sess-y1',
      timestamp: yesterday + 1000,
      kind: 'ai_response',
      payload: {
        response:
          'The following system message was injected by a PreInvocation hook: [Locus Memory — Relevant Recall] noise',
      },
    });
    insertEvent(db, {
      eventId: 'evt-t1',
      projectRoot: scopedProject,
      sessionId: 'sess-t1',
      timestamp: today,
      kind: 'ai_response',
      payload: { response: 'Built workspace gate for Antigravity and Codex.' },
      files: ['packages/cli/src/workspace-gate.ts'],
    });

    const result = syncDailyJournal({
      db,
      projectRoot: projectDir,
      journalDir,
      now: today,
    });

    expect(result.syncedDates).toEqual([yesterdayKey, todayKey]);
    expect(existsSync(join(journalDir, `${yesterdayKey}.md`))).toBe(true);
    expect(existsSync(join(journalDir, `${todayKey}.md`))).toBe(true);
    expect(existsSync(join(journalDir, 'INDEX.md'))).toBe(true);
    expect(readdirSync(journalDir).some((file) => file.endsWith('.tmp'))).toBe(false);

    const yesterdayMd = readFileSync(join(journalDir, `${yesterdayKey}.md`), 'utf8');
    expect(yesterdayMd).toContain(`# ${yesterdayKey} — my-project`);
    expect(yesterdayMd).toContain('Use SQLite WAL with daily summaries.');
    expect(yesterdayMd).toContain('packages/core/src/tools/compact.ts');
    expect(yesterdayMd).not.toContain('Secret other project decision');
    expect(yesterdayMd).not.toContain('PreInvocation hook');

    const indexMd = readFileSync(join(journalDir, 'INDEX.md'), 'utf8');
    expect(indexMd).toContain(`- [${todayKey}](./${todayKey}.md)`);
    expect(indexMd).toContain(`- [${yesterdayKey}](./${yesterdayKey}.md)`);

    const recent = listRecentDailySummaries(db, projectDir, 2);
    expect(recent.map((row) => row.dateKey)).toEqual([todayKey, yesterdayKey]);
  });

  it('includes Recent Days in SessionStart brief and enriches day buckets in handleCalendar', () => {
    const scopedProject = normalizeProjectRootForScope(projectDir);
    const yesterday = new Date(2026, 10, 23, 15, 0, 0).getTime();
    const today = new Date(2026, 10, 24, 10, 0, 0).getTime();
    const yesterdayKey = formatLocalDateKey(yesterday);

    const dCal = store.insert({
      topicKey: 'workspace_isolation',
      memoryType: 'decision',
      summary: 'Enforce strict project workspace boundaries in all hooks.',
      evidence: { confidence: 0.95 },
      projectRoot: scopedProject,
      source: 'antigravity',
    });
    db.run('UPDATE durable_memories SET created_at = ?, updated_at = ? WHERE id = ?', [
      yesterday,
      yesterday,
      dCal.id,
    ]);
    insertEvent(db, {
      eventId: 'evt-cal-1',
      projectRoot: scopedProject,
      sessionId: 'sess-cal-1',
      timestamp: yesterday,
      kind: 'user_prompt',
      payload: { prompt: 'Restrict hooks to real projects.' },
    });

    syncDailyJournal({
      db,
      projectRoot: projectDir,
      journalDir,
      now: today,
    });

    const brief = buildSessionStartBrief(
      {
        db,
        projectRoot: projectDir,
        readGitState: () => ({ gitBranch: 'feat/v4-multi-platform-plugins', dirty: false }),
      },
      { maxTokens: 500 },
    );

    expect(brief.injected).toBe(true);
    expect(brief.text).toContain('Recent Days:');
    expect(brief.text).toContain(`${yesterdayKey}: 1 decisions, 1 events`);

    const cal = handleCalendar(
      { db, projectRoot: projectDir, now: today },
      { timeRange: { relative: 'last_7d' }, granularity: 'day' },
    );
    expect(cal.buckets).toHaveLength(1);
    expect(cal.buckets[0]?.summaryPreview).toContain(
      'Enforce strict project workspace boundaries in all hooks.',
    );
  });
});
