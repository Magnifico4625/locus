import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleRecall } from '../../src/tools/recall.js';
import type {
  DatabaseAdapter,
  DoctorReport,
  EventKind,
  MemoryCalendarResult,
  MemoryRecallResult,
  MemoryStatus,
} from '../../src/types.js';

const trackDFixturesDir = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'codex',
  'tests',
  'fixtures',
  'track-d',
);
const fixedMayNow = Date.parse('2026-05-30T12:00:00.000Z');

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: {
    eventId: string;
    projectRoot: string;
    timestamp: number;
    payloadJson: string;
    sessionId?: string;
    kind?: EventKind;
  },
): void {
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      'codex',
      null,
      normalizeProjectRootForScope(opts.projectRoot),
      opts.sessionId ?? 'sess-1',
      opts.timestamp,
      opts.kind ?? 'session_end',
      opts.payloadJson,
      'high',
      null,
      opts.timestamp,
    ],
  );
}

function insertDurableMemory(
  db: DatabaseAdapter,
  opts: { projectRoot: string; summary: string; topicKey: string; updatedAt: number },
): number {
  return db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json, project_root,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.topicKey,
      'next_step',
      'active',
      opts.summary,
      JSON.stringify({ test: true }),
      normalizeProjectRootForScope(opts.projectRoot),
      null,
      'codex',
      null,
      opts.updatedAt,
      opts.updatedAt,
    ],
  ).lastInsertRowid;
}

function getRegisteredTool(ctx: ServerContext, name: string) {
  const registry = (
    ctx.server as {
      _registeredTools?: Record<
        string,
        { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }
      >;
    }
  )._registeredTools;
  const tool = registry?.[name];
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

async function callTextTool(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = getRegisteredTool(ctx, name);
  const result = await tool.handler(args);
  return result.content[0]?.text ?? '';
}

function copyTrackDFixture(
  source: string,
  destination: string,
  replacements: Record<string, string>,
): void {
  const raw = readFileSync(source, 'utf8');
  const rendered = Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(token, value.replace(/\\/g, '\\\\')),
    raw,
  );
  writeFileSync(destination, rendered, 'utf8');
}

function makeServerFixtureDirs(root: string) {
  const projectDir = join(root, 'ClaudeMagnificoMem');
  const otherProjectDir = join(root, 'ProxyVpn');
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(otherProjectDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  return { projectDir, otherProjectDir, codexHome, sessionsDir };
}

async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withNow<T>(now: number, fn: () => Promise<T>): Promise<T> {
  const previousNow = Date.now;
  Date.now = () => now;
  try {
    return await fn();
  } finally {
    Date.now = previousNow;
  }
}

describe.sequential('Track D memory reliability', () => {
  let dir: string;
  let db: NodeSqliteAdapter;
  const now = Date.parse('2026-05-30T12:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-track-d-'));
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not return unrelated project memories for current-project recall', () => {
    const may12 = Date.parse('2026-05-12T10:00:00.000Z');
    insertConversationEvent(db, {
      eventId: 'locus-1',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-locus',
      timestamp: may12,
      payloadJson: '{"summary":"Locus v3.6.1 CODEX_HOME hotfix."}',
    });
    insertConversationEvent(db, {
      eventId: 'vpn-1',
      projectRoot: 'c:/repo/proxyvpn',
      sessionId: 'sess-vpn',
      timestamp: may12,
      payloadJson: '{"summary":"ProxyVpn v3 route update."}',
    });

    const result = handleRecall(
      'вспомни работу в этом месяце по v3',
      { db, now, projectRoot: 'C:/repo/locus' },
      { timeRange: { relative: 'this_month' }, limit: 10, now, temporalMode: 'utc' },
    ) as MemoryRecallResult;

    const text = JSON.stringify(result).toLowerCase();
    expect(text).toContain('locus');
    expect(text).not.toContain('proxyvpn');
  });

  it('keeps same-topic durable memories isolated by project root', () => {
    const topicKey = 'track_d_memory_reliability';
    const locusId = insertDurableMemory(db, {
      projectRoot: 'c:/repo/locus',
      topicKey,
      summary: 'Locus next step: implement Track D project-scoped recall.',
      updatedAt: now - 60_000,
    });
    insertDurableMemory(db, {
      projectRoot: 'c:/repo/proxyvpn',
      topicKey,
      summary: 'ProxyVpn next step: implement Track D routing recall.',
      updatedAt: now - 30_000,
    });

    const result = handleRecall(
      'what remains to do for track d memory reliability?',
      { db, now, projectRoot: 'C:/repo/locus' },
      { limit: 10, now },
    ) as MemoryRecallResult;

    expect(result.candidates).toEqual([
      expect.objectContaining({
        durableMemoryIds: [locusId],
        projectRoot: 'c:/repo/locus',
      }),
    ]);
    expect(JSON.stringify(result).toLowerCase()).not.toContain('proxyvpn');
  });

  it('returns searched date buckets for date-scoped recall', () => {
    insertConversationEvent(db, {
      eventId: 'locus-may-12',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-12',
      timestamp: Date.parse('2026-05-12T10:00:00.000Z'),
      payloadJson: '{"summary":"Track D project scope checkpoint."}',
    });
    insertConversationEvent(db, {
      eventId: 'locus-may-20',
      projectRoot: 'c:/repo/locus',
      sessionId: 'sess-20',
      timestamp: Date.parse('2026-05-20T10:00:00.000Z'),
      payloadJson: '{"summary":"Track D ranking checkpoint."}',
    });

    const result = handleRecall(
      'what did we do for Track D?',
      { db, now, projectRoot: 'C:/repo/locus' },
      { timeRange: { relative: 'this_month' }, limit: 10, now, temporalMode: 'utc' },
    ) as MemoryRecallResult;

    expect(result.searchedDateBuckets?.map((bucket) => bucket.key)).toEqual([
      '2026-05-12',
      '2026-05-20',
    ]);
  });

  it('recalls current-project month work without other-project JSONL noise', async () => {
    const { projectDir, otherProjectDir, codexHome, sessionsDir } = makeServerFixtureDirs(
      join(dir, 'server-current-project'),
    );
    const replacements = {
      __TRACKD_CURRENT_PROJECT__: projectDir,
      __TRACKD_OTHER_PROJECT__: otherProjectDir,
    };
    copyTrackDFixture(
      join(trackDFixturesDir, 'current-project-may.jsonl'),
      join(sessionsDir, 'rollout-a-current-project-may.jsonl'),
      replacements,
    );
    copyTrackDFixture(
      join(trackDFixturesDir, 'other-project-may.jsonl'),
      join(sessionsDir, 'rollout-b-other-project-may.jsonl'),
      replacements,
    );

    await withEnv(
      {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'redacted',
        LOCUS_CAPTURE_LEVEL: 'redacted',
      },
      () =>
        withNow(fixedMayNow, async () => {
          const ctx = await createServer({ cwd: projectDir, dbPath: join(dir, 'server.db') });
          try {
            const importResult = JSON.parse(
              await callTextTool(ctx, 'memory_import_codex', {}),
            ) as { imported: number };
            const recallText = await callTextTool(ctx, 'memory_recall', {
              question: 'вспомни работу в этом месяце',
              timeRange: { relative: 'this_month' },
              limit: 10,
            });

            expect(importResult.imported).toBeGreaterThan(0);
            expect(recallText).toContain('TRACKD-LOCUS-MAY-20260530');
            expect(recallText).not.toContain('TRACKD-PROXYVPN-NOISE-20260530');
          } finally {
            ctx.cleanup();
          }
        }),
    );
  });

  it('reports date buckets searched for this month from imported Codex JSONL', async () => {
    const { projectDir, otherProjectDir, codexHome, sessionsDir } = makeServerFixtureDirs(
      join(dir, 'server-date-buckets'),
    );
    copyTrackDFixture(
      join(trackDFixturesDir, 'current-project-may.jsonl'),
      join(sessionsDir, 'rollout-current-project-may.jsonl'),
      {
        __TRACKD_CURRENT_PROJECT__: projectDir,
        __TRACKD_OTHER_PROJECT__: otherProjectDir,
      },
    );

    await withEnv(
      {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'redacted',
        LOCUS_CAPTURE_LEVEL: 'redacted',
      },
      () =>
        withNow(fixedMayNow, async () => {
          const ctx = await createServer({ cwd: projectDir, dbPath: join(dir, 'buckets.db') });
          try {
            await callTextTool(ctx, 'memory_import_codex', {});
            const recall = JSON.parse(
              await callTextTool(ctx, 'memory_recall', {
                question: 'вспомни работу в этом месяце',
                timeRange: { relative: 'this_month' },
                limit: 10,
              }),
            ) as MemoryRecallResult;

            expect(recall.searchedDateBuckets).toEqual(
              expect.arrayContaining([expect.objectContaining({ key: '2026-05-30' })]),
            );
          } finally {
            ctx.cleanup();
          }
        }),
    );
  });

  it('treats explicit desktop surface as observed after marker auto-import and recall', async () => {
    const { projectDir, otherProjectDir, codexHome, sessionsDir } = makeServerFixtureDirs(
      join(dir, 'server-desktop'),
    );
    copyTrackDFixture(
      join(trackDFixturesDir, 'desktop-marker.jsonl'),
      join(sessionsDir, 'rollout-z-desktop-marker.jsonl'),
      {
        __TRACKD_CURRENT_PROJECT__: projectDir,
        __TRACKD_OTHER_PROJECT__: otherProjectDir,
      },
    );

    await withEnv(
      {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'redacted',
        LOCUS_CAPTURE_LEVEL: 'redacted',
        LOCUS_CODEX_SURFACE: 'desktop',
      },
      () =>
        withNow(fixedMayNow, async () => {
          const ctx = await createServer({ cwd: projectDir, dbPath: join(dir, 'desktop.db') });
          try {
            const recallText = await callTextTool(ctx, 'memory_recall', {
              question: 'TRACKD-DESKTOP-MARKER-20260530',
              timeRange: { relative: 'this_month' },
              limit: 10,
            });
            const status = JSON.parse(await callTextTool(ctx, 'memory_status', {})) as MemoryStatus;
            const doctor = JSON.parse(await callTextTool(ctx, 'memory_doctor', {})) as DoctorReport;

            expect(recallText).toContain('TRACKD-DESKTOP-MARKER-20260530');
            expect(status.codexDiagnostics).toMatchObject({ clientSurface: 'desktop' });
            expect(status.codexAutoImport.clientSurface).toBe('desktop');
            expect(status.codexAutoImport.lastImported).toBeGreaterThan(0);
            expect(doctor.checks).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ name: 'Codex desktop parity', status: 'ok' }),
              ]),
            );
          } finally {
            ctx.cleanup();
          }
        }),
    );
  });

  it('calendar runs the same debounced pre-query import flow before reading buckets', async () => {
    const { projectDir, otherProjectDir, codexHome, sessionsDir } = makeServerFixtureDirs(
      join(dir, 'server-calendar'),
    );
    copyTrackDFixture(
      join(trackDFixturesDir, 'other-project-may.jsonl'),
      join(sessionsDir, 'rollout-a-other-project-may.jsonl'),
      {
        __TRACKD_CURRENT_PROJECT__: projectDir,
        __TRACKD_OTHER_PROJECT__: otherProjectDir,
      },
    );
    writeFileSync(
      join(sessionsDir, 'rollout-z-calendar-autoimport.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-05-30T12:00:00.000Z',
          session_id: 'sess_track_d_calendar_autoimport_001',
          cwd: projectDir,
          model: 'gpt-5.4',
        }),
        JSON.stringify({
          type: 'event_msg',
          subtype: 'user_message',
          timestamp: '2026-05-30T12:01:00.000Z',
          message:
            'Calendar auto-import validation for Track D: TRACKD-CALENDAR-AUTOIMPORT.',
        }),
        JSON.stringify({
          type: 'event_msg',
          subtype: 'task_complete',
          timestamp: '2026-05-30T12:02:00.000Z',
          message: 'Track D calendar marker completed: TRACKD-CALENDAR-AUTOIMPORT.',
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    await withEnv(
      {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'redacted',
        LOCUS_CAPTURE_LEVEL: 'redacted',
      },
      () =>
        withNow(fixedMayNow, async () => {
          const ctx = await createServer({ cwd: projectDir, dbPath: join(dir, 'calendar.db') });
          try {
            const calendar = JSON.parse(
              await callTextTool(ctx, 'memory_calendar', {
                timeRange: { relative: 'this_month' },
                granularity: 'day',
              }),
            ) as MemoryCalendarResult;
            const status = JSON.parse(await callTextTool(ctx, 'memory_status', {})) as MemoryStatus;

            expect(calendar.buckets).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ key: '2026-05-30', eventCount: 3 }),
              ]),
            );
            expect(JSON.stringify(calendar)).not.toContain('TRACKD-PROXYVPN-NOISE-20260530');
            expect(status.codexAutoImport.lastStatus).toBe('imported');
            expect(status.codexAutoImport.lastImported).toBeGreaterThan(0);
          } finally {
            ctx.cleanup();
          }
        }),
    );
  });
});
