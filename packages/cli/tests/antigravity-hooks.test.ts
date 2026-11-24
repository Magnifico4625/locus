import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatLocalDateKey,
  initStorage,
  resolveJournalDirFromDbPath,
  resolveProjectRoot,
} from '@locus/core';
import { resolveDbPath, resolveInboxDir } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { readAntigravitySessionState } from '../src/antigravity/session-state.js';
import { antigravityTranscriptCursorKey } from '../src/antigravity/transcript.js';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];
const savedEnv = { ...process.env };

function makeTempDir(prefix = 'locus-ag-hooks-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

function setupSandbox() {
  const root = makeTempDir();
  const projectDir = join(root, 'workspace');
  const locusHome = join(root, 'locus-home');
  const storageRoot = join(root, 'memory-storage');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"name":"ag-demo","version":"1.0.0"}', 'utf8');

  const env = {
    LOCUS_HOME: locusHome,
    LOCUS_STORAGE_ROOT: storageRoot,
    LOCUS_CAPTURE_LEVEL: 'redacted',
  };

  process.env.LOCUS_HOME = locusHome;
  process.env.LOCUS_STORAGE_ROOT = storageRoot;
  delete process.env.CODEX_HOME;
  delete process.env.CLAUDE_PLUGIN_ROOT;

  return { root, projectDir, locusHome, storageRoot, env };
}

afterEach(() => {
  process.env = { ...savedEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('antigravity lifecycle hooks', () => {
  it('captures transcript decisions on stop incrementally without thinking, redacts secrets, and skips duplicates', async () => {
    const { root, projectDir, env } = setupSandbox();
    const transcriptPath = join(root, 'transcript.jsonl');
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    const initialLines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-22T10:00:00Z',
        content:
          'Decision: let us use PostgreSQL with pgvector using sk-1234567890abcdefghijklmnop',
      }),
      JSON.stringify({
        step_index: 1,
        source: 'SYSTEM_SDK',
        type: 'EPHEMERAL_MESSAGE',
        status: 'DONE',
        created_at: '2026-11-22T10:00:01Z',
        content: 'Internal SDK system step should be ignored',
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-22T10:00:05Z',
        model: 'gemini-4-neon-xhigh',
        thinking: 'SECRET_INTERNAL_CHAIN_OF_THOUGHT_DO_NOT_CAPTURE',
        content: 'Decision: PostgreSQL chosen for relational durability and JSONB indexing.',
      }),
    ];
    writeFileSync(transcriptPath, `${initialLines.join('\n')}\n`, 'utf8');

    const stop1 = createIo();
    const code1 = await runCli(['hook', 'antigravity', 'stop'], stop1.io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-stop-1',
        workspacePaths: [projectDir],
        transcriptPath,
        hookEventName: 'Stop',
      }),
    });

    expect(code1).toBe(0);
    expect(stop1.stderr).toEqual([]);
    expect(JSON.parse(stop1.stdout.join('\n'))).toEqual({});

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const events = db.all<{
        kind: string;
        source: string;
        payload_json: string | null;
      }>('SELECT kind, source, payload_json FROM conversation_events ORDER BY timestamp ASC');
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.source === 'antigravity')).toBe(true);
      expect(events.map((e) => e.kind)).toEqual(['user_prompt', 'ai_response']);

      const joinedPayloads = events.map((e) => e.payload_json ?? '').join('\n');
      expect(joinedPayloads).not.toContain('sk-1234567890abcdefghijklmnop');
      expect(joinedPayloads).toContain('sk-[REDACTED]');
      expect(joinedPayloads).not.toContain('SECRET_INTERNAL_CHAIN_OF_THOUGHT_DO_NOT_CAPTURE');
      expect(joinedPayloads).not.toContain('Internal SDK system step');

      const cursor = db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
        antigravityTranscriptCursorKey('conv-stop-1'),
      ]);
      expect(cursor?.value).toBe('2');

      const durable = db.all<{ summary: string }>(
        'SELECT summary FROM durable_memories WHERE state = ?',
        ['active'],
      );
      expect(durable.some((row) => row.summary.includes('PostgreSQL'))).toBe(true);
    } finally {
      db.close();
    }

    // Running Stop again without new steps inserts 0 duplicate rows
    const stop2 = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'stop'], stop2.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-stop-1',
          workspacePaths: [projectDir],
          transcriptPath,
        }),
      }),
    ).toBe(0);

    // Appending a new step advances cursor incrementally
    writeFileSync(
      transcriptPath,
      `${[
        ...initialLines,
        JSON.stringify({
          step_index: 3,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          status: 'DONE',
          created_at: '2026-11-22T10:01:00Z',
          content: 'Next step: add SQLite migration helper tests.',
        }),
      ].join('\n')}\n`,
      'utf8',
    );

    const stop3 = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'stop'], stop3.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-stop-1',
          workspacePaths: [projectDir],
          transcriptPath,
        }),
      }),
    ).toBe(0);

    const { db: dbAfter } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const count = dbAfter.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_events');
      expect(count?.cnt).toBe(3);
      const cursor = dbAfter.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
        antigravityTranscriptCursorKey('conv-stop-1'),
      ]);
      expect(cursor?.value).toBe('3');
    } finally {
      dbAfter.close();
    }
  });

  it('injects session-start brief via injectSteps and deduplicates pre-invocation turns and noise', async () => {
    const { root, projectDir, env } = setupSandbox();
    const transcriptPath = join(root, 'transcript.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        step_index: 0,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-22T10:00:00Z',
        content: 'Decision: use Redis Cluster for distributed rate limiting.',
      })}\n`,
      'utf8',
    );

    await runCli(['hook', 'antigravity', 'stop'], createIo().io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-seed',
        workspacePaths: [projectDir],
        transcriptPath,
      }),
    });

    const sessionStart = createIo();
    const startCode = await runCli(['hook', 'antigravity', 'session-start'], sessionStart.io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-live-1',
        workspacePaths: [projectDir],
        hookEventName: 'SessionStart',
      }),
    });

    expect(startCode).toBe(0);
    const startOutput = JSON.parse(sessionStart.stdout.join('\n')) as {
      injectSteps?: Array<{ systemMessage?: { systemMessage?: string } }>;
    };
    const startText = startOutput.injectSteps?.[0]?.systemMessage?.systemMessage ?? '';
    expect(startText).toContain('[Locus Memory — Project Brief]');
    expect(startText).toContain('Redis Cluster');

    const stateAfterStart = readAntigravitySessionState('conv-live-1', env);
    expect(stateAfterStart.sessionStartInjected).toBe(true);
    expect(stateAfterStart.injectedDurableIds.length).toBeGreaterThan(0);

    // Noisy prompt returns {}
    const noisy = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'pre-invocation'], noisy.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-live-1',
          workspacePaths: [projectDir],
          lastUserInput: 'продолжай',
        }),
      }),
    ).toBe(0);
    expect(JSON.parse(noisy.stdout.join('\n'))).toEqual({});

    // Prompt asking about Redis Cluster is already covered by session-start durable dedup -> returns {}
    const alreadyCovered = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'pre-invocation'], alreadyCovered.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-live-1',
          workspacePaths: [projectDir],
          lastUserInput: 'Why did we pick Redis Cluster for rate limiting?',
        }),
      }),
    ).toBe(0);
    expect(JSON.parse(alreadyCovered.stdout.join('\n'))).toEqual({});

    // Fresh conversation without SessionStart gets PreInvocation brief once, then deduped on repeated loop
    const freshPrompt = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'pre-invocation'], freshPrompt.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-live-2',
          workspacePaths: [projectDir],
          lastUserInput: 'What did we decide about rate limiting with Redis Cluster?',
        }),
      }),
    ).toBe(0);
    const freshOutput = JSON.parse(freshPrompt.stdout.join('\n')) as {
      injectSteps?: Array<{ systemMessage?: { systemMessage?: string } }>;
    };
    expect(freshOutput.injectSteps?.[0]?.systemMessage?.systemMessage).toContain('Redis Cluster');

    const repeatedLoop = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'pre-invocation'], repeatedLoop.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-live-2',
          workspacePaths: [projectDir],
          lastUserInput: 'What did we decide about rate limiting with Redis Cluster?',
        }),
      }),
    ).toBe(0);
    expect(JSON.parse(repeatedLoop.stdout.join('\n'))).toEqual({});
  });

  it('captures mutating/error tools in post-tool-use, filters denylisted paths, and skips read/locus tools', async () => {
    const { projectDir, env } = setupSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const inboxDir = resolveInboxDir(canonicalRoot);

    // 1. Successful read_file -> ignored
    await runCli(['hook', 'antigravity', 'post-tool-use'], createIo().io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-tools-1',
        workspacePaths: [projectDir],
        toolCall: { id: 't1', name: 'read_file', args: { Path: join(projectDir, 'README.md') } },
      }),
    });
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toHaveLength(0);

    // 2. Locus MCP tool -> ignored to prevent self-capture loops
    await runCli(['hook', 'antigravity', 'post-tool-use'], createIo().io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-tools-1',
        workspacePaths: [projectDir],
        toolCall: { id: 't2', name: 'memory_recall', args: {} },
        error: 'simulated error',
      }),
    });
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toHaveLength(0);

    // 3. edit_file with both safe path and denylisted .env -> captures safe path only
    await runCli(['hook', 'antigravity', 'post-tool-use'], createIo().io, {
      env,
      stdin: JSON.stringify({
        conversationId: 'conv-tools-1',
        workspacePaths: [projectDir],
        toolCall: {
          id: 't3',
          name: 'edit_file',
          args: {
            Path: join(projectDir, '.env'),
            TargetFile: join(projectDir, 'src', 'app.ts'),
          },
        },
      }),
    });

    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(inboxDir, files[0] ?? ''), 'utf8')) as {
      source: string;
      kind: string;
      payload: { tool: string; files: string[]; status: string };
    };
    expect(written.source).toBe('antigravity');
    expect(written.kind).toBe('tool_use');
    expect(written.payload.tool).toBe('edit_file');
    expect(written.payload.status).toBe('success');
    expect(written.payload.files).toEqual([join(projectDir, 'src', 'app.ts')]);
  });

  it('respects metadata capture mode on stop and fails open on malformed stdin', async () => {
    const { root, projectDir, env } = setupSandbox();
    const metadataEnv = { ...env, LOCUS_CAPTURE_LEVEL: 'metadata' };
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const transcriptPath = join(root, 'transcript.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-22T10:00:00Z',
        content: 'Decision: must not capture prompt text in metadata mode.',
      })}\n`,
      'utf8',
    );

    const metaStop = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'stop'], metaStop.io, {
        env: metadataEnv,
        stdin: JSON.stringify({
          conversationId: 'conv-meta',
          workspacePaths: [projectDir],
          transcriptPath,
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const count = db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_events');
      expect(count?.cnt).toBe(0);
      const cursor = db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
        antigravityTranscriptCursorKey('conv-meta'),
      ]);
      expect(cursor?.value).toBe('0');
    } finally {
      db.close();
    }

    const malformed = createIo();
    const malformedCode = await runCli(['hook', 'antigravity', 'pre-invocation'], malformed.io, {
      env,
      stdin: '{bad json',
    });
    expect(malformedCode).toBe(0);
    expect(JSON.parse(malformed.stdout.join('\n'))).toEqual({});
    expect(malformed.stderr.join('\n')).toContain('failing open');

    const unsupported = createIo();
    expect(await runCli(['hook', 'antigravity', 'unknown-event'], unsupported.io, { env })).toBe(1);
  });

  it('strips Antigravity XML request/metadata envelopes and drops noisy or injected wrappers on stop', async () => {
    const { root, projectDir, env } = setupSandbox();
    const transcriptPath = join(root, 'transcript-envelopes.jsonl');
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    const lines = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-23T12:00:00Z',
        content: [
          '<USER_REQUEST>',
          'Refactor WorkerPool to initialize SQLite lazily after MCP roots/list.',
          '</USER_REQUEST>',
          '<ADDITIONAL_METADATA>',
          'The current local time is: 2026-11-23T12:00:00+03:00.',
          '</ADDITIONAL_METADATA>',
          '<SYSTEM_MESSAGE>',
          '[Locus Memory — Relevant Recall]',
          '- [general] unrelated chatter',
          '</SYSTEM_MESSAGE>',
        ].join('\n'),
      }),
      JSON.stringify({
        step_index: 1,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-23T12:00:05Z',
        content:
          '<SYSTEM_MESSAGE>\n[notice] server started\n</SYSTEM_MESSAGE>\n<CONTEXT_SUMMARY>\nSummary block\n</CONTEXT_SUMMARY>',
      }),
      JSON.stringify({
        step_index: 2,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-23T12:00:10Z',
        content:
          '<USER_REQUEST>\nок\n</USER_REQUEST>\n<ADDITIONAL_METADATA>time</ADDITIONAL_METADATA>',
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-23T12:00:15Z',
        content: '[Locus Memory — Project Brief]\nProject: demo',
      }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-23T12:00:20Z',
        content: 'Decision: initialize WorkspacePool lazily when real workspace root arrives.',
      }),
    ];
    writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf8');

    const res = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'stop'], res.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-envelopes',
          workspacePaths: [projectDir],
          transcriptPath,
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const events = db.all<{ kind: string; payload_json: string | null }>(
        'SELECT kind, payload_json FROM conversation_events ORDER BY timestamp ASC',
      );
      expect(events).toHaveLength(2);
      expect(events[0]?.kind).toBe('user_prompt');
      expect(events[0]?.payload_json).toContain(
        'Refactor WorkerPool to initialize SQLite lazily after MCP roots/list.',
      );
      expect(events[0]?.payload_json).not.toContain('<USER_REQUEST>');
      expect(events[0]?.payload_json).not.toContain('<ADDITIONAL_METADATA>');
      expect(events[0]?.payload_json).not.toContain('<SYSTEM_MESSAGE>');

      expect(events[1]?.kind).toBe('ai_response');
      expect(events[1]?.payload_json).toContain('initialize WorkspacePool lazily');
    } finally {
      db.close();
    }
  });

  it('silently ignores workspace-less, home, agent-config, and non-project paths without creating storage', async () => {
    const { root, storageRoot, env } = setupSandbox();
    const nonProjectDir = join(root, 'plain-dir');
    mkdirSync(nonProjectDir, { recursive: true });

    const disallowedInputs = [
      { conversationId: 'conv-missing-ws', lastUserInput: 'hello without workspace' },
      {
        conversationId: 'conv-home-ws',
        cwd: homedir(),
        lastUserInput: 'Decision: do not capture home',
      },
      {
        conversationId: 'conv-plugin-ws',
        cwd: join(homedir(), '.gemini', 'config', 'plugins', 'locus-memory'),
        lastUserInput: 'BugHunter session leak check',
      },
      {
        conversationId: 'conv-plain-ws',
        workspacePaths: [nonProjectDir],
        lastUserInput: 'random non-project dir check',
      },
    ];

    for (const payload of disallowedInputs) {
      const res = createIo();
      expect(
        await runCli(['hook', 'antigravity', 'pre-invocation'], res.io, {
          env,
          stdin: JSON.stringify(payload),
        }),
      ).toBe(0);
      expect(JSON.parse(res.stdout.join('\n'))).toEqual({});
    }

    expect(existsSync(storageRoot)).toBe(false);
  });

  it('strips PreInvocation hook echo text from transcripts and writes daily journal files on Stop', async () => {
    const { root, projectDir, env } = setupSandbox();
    const transcriptPath = join(root, 'transcript-echo-journal.jsonl');
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const nowIso = '2026-11-24T09:15:00Z';
    const expectedDateKey = formatLocalDateKey(Date.parse(nowIso));

    writeFileSync(
      transcriptPath,
      `${[
        JSON.stringify({
          step_index: 0,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          status: 'DONE',
          created_at: nowIso,
          content:
            'The following system message was injected by a PreInvocation hook:\n[Locus Memory — Relevant Recall]\n- [general] should never be stored',
        }),
        JSON.stringify({
          step_index: 1,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          status: 'DONE',
          created_at: nowIso,
          content:
            '<USER_REQUEST>\nDecision: enforce strict project workspace isolation and daily journals.\n</USER_REQUEST>\n<SYSTEM_MESSAGE>The following system message was injected by a PreInvocation hook: leaked</SYSTEM_MESSAGE>',
        }),
      ].join('\n')}\n`,
      'utf8',
    );

    const stopIo = createIo();
    expect(
      await runCli(['hook', 'antigravity', 'stop'], stopIo.io, {
        env,
        stdin: JSON.stringify({
          conversationId: 'conv-journal-ag',
          workspacePaths: [projectDir],
          transcriptPath,
        }),
      }),
    ).toBe(0);

    const dbPath = resolveDbPath(canonicalRoot);
    const { db } = await initStorage(dbPath);
    try {
      const rows = db.all<{ payload_json: string | null }>(
        'SELECT payload_json FROM conversation_events',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload_json).toContain('strict project workspace isolation');
      expect(JSON.stringify(rows)).not.toContain('PreInvocation hook');
    } finally {
      db.close();
    }

    const journalDir = resolveJournalDirFromDbPath(dbPath);
    const actualFiles = readdirSync(journalDir);
    expect(actualFiles).toContain('INDEX.md');
    expect(actualFiles.some((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))).toBe(true);
    const todayOrSyncedFile =
      actualFiles.find((name) => name !== 'INDEX.md') ?? `${expectedDateKey}.md`;
    expect(readFileSync(join(journalDir, todayOrSyncedFile), 'utf8')).toContain(
      'enforce strict project workspace isolation and daily journals.',
    );
  });
});
