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
import { initStorage, resolveJournalDirFromDbPath, resolveProjectRoot } from '@locus/core';
import { resolveDbPath, resolveInboxDir } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexHookCommand,
  buildCodexHooksConfig,
  inspectCodexHooks,
  renderCodexHooksJson,
} from '../src/codex/hooks.js';
import { readHookSessionState } from '../src/hook-session-state.js';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];
const savedEnv = { ...process.env };

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-hooks-'));
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

function createSandbox() {
  const root = makeTempDir();
  const codexHome = join(root, 'codex-home');
  const locusHome = join(root, 'locus-home');
  const storageRoot = join(root, 'memory-storage');
  const projectDir = join(root, 'workspace');
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(locusHome, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'package.json'),
    '{"name":"codex-demo","version":"1.2.0"}',
    'utf8',
  );

  const env = {
    CODEX_HOME: codexHome,
    LOCUS_HOME: locusHome,
    LOCUS_STORAGE_ROOT: storageRoot,
    LOCUS_CODEX_CAPTURE: 'redacted',
    LOCUS_CAPTURE_LEVEL: 'redacted',
  };

  process.env.CODEX_HOME = codexHome;
  process.env.LOCUS_HOME = locusHome;
  process.env.LOCUS_STORAGE_ROOT = storageRoot;
  delete process.env.CLAUDE_PLUGIN_ROOT;

  return { root, codexHome, locusHome, storageRoot, projectDir, env };
}

afterEach(() => {
  process.env = { ...savedEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex hook command', () => {
  it.each(['session-start', 'user-prompt-submit', 'stop'])('accepts %s events', async (event) => {
    const { projectDir, env } = createSandbox();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', event], io, {
      env,
      stdin: JSON.stringify({ hook_event_name: event, cwd: projectDir }),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ continue: true });
  });

  it('accepts post-tool-use events with empty silent stdout', async () => {
    const { projectDir, env } = createSandbox();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'post-tool-use'], io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'PostToolUse',
        cwd: projectDir,
        tool_name: 'Read',
        tool_input: { path: join(projectDir, 'README.md') },
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([]);
  });

  it('rejects unsupported events', async () => {
    const { env } = createSandbox();
    const { io, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'unknown-event'], io, {
      env,
      stdin: '{}',
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Unsupported Codex hook event');
  });

  it('fails open with valid JSON when Stop receives malformed stdin', async () => {
    const { env } = createSandbox();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'stop'], io, {
      env,
      stdin: '{bad json',
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('\n')).toContain('malformed Codex hook input');
    expect(JSON.parse(stdout.join('\n'))).toEqual({ continue: true, suppressOutput: true });
  });

  it('writes a Stop trigger marker atomically without leaving temp files', async () => {
    const { codexHome, projectDir, env } = createSandbox();
    const { io } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'stop'], io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'session-1',
        turn_id: 'turn-1',
        cwd: projectDir,
      }),
    });

    expect(exitCode).toBe(0);
    const triggerDir = join(codexHome, 'locus', 'hook-triggers');
    const files = readdirSync(triggerDir);
    expect(files).toHaveLength(1);
    const markerFile = files[0] ?? '';
    expect(markerFile).toMatch(/^stop-\d+-[a-f0-9]+\.json$/u);
    expect(readdirSync(triggerDir).some((file) => file.endsWith('.tmp'))).toBe(false);
    expect(JSON.parse(readFileSync(join(triggerDir, markerFile), 'utf8'))).toMatchObject({
      event: 'stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
    });
  });

  it('imports Codex rollout JSONL on Stop, injects SessionStart & UserPromptSubmit context, and deduplicates', async () => {
    const { codexHome, projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const rolloutDir = join(codexHome, 'sessions', '2026', '11', '23');
    mkdirSync(rolloutDir, { recursive: true });
    writeFileSync(
      join(rolloutDir, 'rollout-2026-11-23-01.jsonl'),
      `${[
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-11-23T10:00:00.000Z',
          session_id: 'sess-codex-1',
          cwd: projectDir,
          model: 'gpt-5.4',
        }),
        JSON.stringify({
          type: 'event_msg',
          subtype: 'user_message',
          timestamp: '2026-11-23T10:00:01.000Z',
          message: 'Decision: use SQLite WAL mode for Codex local storage.',
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-11-23T10:00:05.000Z',
          item: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Decision: SQLite WAL mode configured for fast concurrent reads and writes.',
              },
            ],
          },
        }),
      ].join('\n')}\n`,
      'utf8',
    );

    const stopIo = createIo();
    const stopCode = await runCli(['hook', 'codex', 'stop'], stopIo.io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'sess-codex-1',
        turn_id: 'turn-1',
        cwd: projectDir,
      }),
    });
    expect(stopCode).toBe(0);
    expect(JSON.parse(stopIo.stdout.join('\n'))).toEqual({
      continue: true,
      suppressOutput: true,
    });

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const durable = db.all<{ summary: string }>(
        "SELECT summary FROM durable_memories WHERE state = 'active'",
      );
      expect(durable.some((row) => row.summary.includes('SQLite WAL mode'))).toBe(true);
    } finally {
      db.close();
    }

    // SessionStart in a new session injects [Locus Memory — Project Brief]
    const startIo = createIo();
    const startCode = await runCli(['hook', 'codex', 'session-start'], startIo.io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'sess-codex-live-1',
        cwd: projectDir,
      }),
    });
    expect(startCode).toBe(0);
    const startOut = JSON.parse(startIo.stdout.join('\n')) as {
      continue: boolean;
      suppressOutput: boolean;
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    };
    expect(startOut.continue).toBe(true);
    expect(startOut.hookSpecificOutput?.hookEventName).toBe('SessionStart');
    expect(startOut.hookSpecificOutput?.additionalContext).toContain(
      '[Locus Memory — Project Brief]',
    );
    expect(startOut.hookSpecificOutput?.additionalContext).toContain('SQLite WAL mode');

    const startState = readHookSessionState('codex', 'sess-codex-live-1', env);
    expect(startState.sessionStartInjected).toBe(true);
    expect(startState.injectedDurableIds.length).toBeGreaterThan(0);

    // Asking the same question right after SessionStart in that session is deduplicated
    const dupIo = createIo();
    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], dupIo.io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-codex-live-1',
          cwd: projectDir,
          prompt: 'Why did we choose SQLite WAL mode for local storage?',
        }),
      }),
    ).toBe(0);
    expect(JSON.parse(dupIo.stdout.join('\n'))).toEqual({
      continue: true,
      suppressOutput: true,
    });

    // Fresh session without SessionStart gets UserPromptSubmit additionalContext once, then dedups
    const freshPromptIo = createIo();
    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], freshPromptIo.io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-codex-live-2',
          cwd: projectDir,
          prompt: 'What did we decide about SQLite WAL mode?',
        }),
      }),
    ).toBe(0);
    const promptOut = JSON.parse(freshPromptIo.stdout.join('\n')) as {
      hookSpecificOutput?: { hookEventName: string; additionalContext: string };
    };
    expect(promptOut.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
    expect(promptOut.hookSpecificOutput?.additionalContext).toContain(
      '[Locus Memory — Relevant Recall]',
    );
    expect(promptOut.hookSpecificOutput?.additionalContext).toContain('SQLite WAL mode');

    // Noisy prompt stays silent without hookSpecificOutput
    for (const noisyPrompt of ['продолжай', 'ok']) {
      const noisyIo = createIo();
      expect(
        await runCli(['hook', 'codex', 'user-prompt-submit'], noisyIo.io, {
          env,
          stdin: JSON.stringify({
            session_id: 'sess-codex-live-2',
            cwd: projectDir,
            prompt: noisyPrompt,
          }),
        }),
      ).toBe(0);
      expect(JSON.parse(noisyIo.stdout.join('\n'))).toEqual({
        continue: true,
        suppressOutput: true,
      });
    }
  });

  it('captures Bash/Edit/error PostToolUse into inbox, filters .env, skips Read and memory_*', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const inboxDir = resolveInboxDir(canonicalRoot);

    // Ignored: successful Read & memory_recall
    await runCli(['hook', 'codex', 'post-tool-use'], createIo().io, {
      env,
      stdin: JSON.stringify({
        session_id: 'sess-tools',
        cwd: projectDir,
        tool_name: 'Read',
        tool_input: { path: join(projectDir, 'README.md') },
      }),
    });
    await runCli(['hook', 'codex', 'post-tool-use'], createIo().io, {
      env,
      stdin: JSON.stringify({
        session_id: 'sess-tools',
        cwd: projectDir,
        tool_name: 'memory_recall',
        error: 'ignored internal tool error',
      }),
    });
    expect(existsSync(inboxDir) ? readdirSync(inboxDir) : []).toHaveLength(0);

    // Captured: Edit with .env filtered + safe target_file
    const editIo = createIo();
    const editCode = await runCli(['hook', 'codex', 'post-tool-use'], editIo.io, {
      env,
      stdin: JSON.stringify({
        session_id: 'sess-tools',
        cwd: projectDir,
        call_id: 'call-1',
        tool_name: 'Edit',
        tool_input: {
          path: join(projectDir, '.env'),
          target_file: join(projectDir, 'src', 'worker.ts'),
        },
      }),
    });
    expect(editCode).toBe(0);
    expect(editIo.stdout).toEqual([]);

    const files = readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(inboxDir, files[0] ?? ''), 'utf8')) as {
      source: string;
      kind: string;
      payload: { tool: string; files: string[]; status: string };
    };
    expect(written.source).toBe('codex');
    expect(written.kind).toBe('tool_use');
    expect(written.payload.tool).toBe('Edit');
    expect(written.payload.files).toEqual([join(projectDir, 'src', 'worker.ts')]);
    expect(written.payload.status).toBe('success');
  });

  it('does not depend on MCP server implementation modules', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'commands', 'hook-codex.ts'),
      'utf8',
    );

    expect(source).not.toContain('runMcp');
    expect(source).not.toContain('commands/mcp');
    expect(existsSync(join(import.meta.dirname, '..', 'src', 'commands', 'hook-codex.ts'))).toBe(
      true,
    );
  });
});

describe('codex hook config generation', () => {
  it('generates lifecycle hooks for SessionStart, UserPromptSubmit, PostToolUse, and Stop', () => {
    const config = buildCodexHooksConfig({ version: '3.7.0' });

    expect(Object.keys(config.hooks).sort()).toEqual([
      'PostToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);

    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'] as const) {
      expect(config.hooks[event]).toHaveLength(1);
      expect(config.hooks[event]?.[0]?.hooks).toHaveLength(1);
      expect(config.hooks[event]?.[0]?.hooks[0]).toMatchObject({
        type: 'command',
        timeout: 3,
      });
      expect(config.hooks[event]?.[0]?.hooks[0]?.command).toContain('locus-memory@3.7.0');
      expect(config.hooks[event]?.[0]?.hooks[0]?.command).not.toContain('@latest');
    }
  });

  it('produces versionless identical hooks.json across versions when runtimeCliPath is supplied (trusted_hash stability)', () => {
    const cliPath = 'C:\\Users\\Admin\\.locus\\bin\\cli.js';
    const v370 = renderCodexHooksJson(
      buildCodexHooksConfig({ version: '3.7.0', runtimeCliPath: cliPath }),
    );
    const v400 = renderCodexHooksJson(
      buildCodexHooksConfig({ version: '4.0.0', runtimeCliPath: cliPath }),
    );

    expect(v370).toBe(v400);
    const parsed = JSON.parse(v370) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(parsed.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      `node ${cliPath} hook codex session-start`,
    );
    expect(parsed.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
      `node ${cliPath} hook codex user-prompt-submit`,
    );
    expect(parsed.hooks.PostToolUse?.[0]?.hooks[0]?.command).toBe(
      `node ${cliPath} hook codex post-tool-use`,
    );
    expect(parsed.hooks.Stop?.[0]?.hooks[0]?.command).toBe(`node ${cliPath} hook codex stop`);
  });

  it('uses event-specific hook command arguments', () => {
    const config = buildCodexHooksConfig({ version: '3.7.0', platform: 'linux' });

    expect(config.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex session-start',
    );
    expect(config.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex user-prompt-submit',
    );
    expect(config.hooks.PostToolUse?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex post-tool-use',
    );
    expect(config.hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex stop',
    );
  });

  it('quotes Windows command paths with spaces for installed binary policy', () => {
    expect(
      buildCodexHookCommand({
        event: 'stop',
        binaryPath: 'C:\\Program Files\\Locus\\locus-memory.cmd',
      }),
    ).toBe('"C:\\Program Files\\Locus\\locus-memory.cmd" hook codex stop');
  });

  it('renders deterministic pretty JSON for hooks.json', () => {
    const json = renderCodexHooksJson(buildCodexHooksConfig({ version: '3.7.0' }));

    expect(JSON.parse(json)).toEqual(buildCodexHooksConfig({ version: '3.7.0' }));
    expect(json).toMatch(/^\{\n {2}"hooks":/u);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('inspects configured hooks from both installed binary and local runtime node commands', () => {
    const codexHome = makeTempDir();
    writeFileSync(
      join(codexHome, 'hooks.json'),
      renderCodexHooksJson(
        buildCodexHooksConfig({
          version: '3.7.0',
          binaryPath: 'C:\\Program Files\\Locus\\locus-memory.cmd',
        }),
      ),
      'utf8',
    );

    expect(inspectCodexHooks({ env: { CODEX_HOME: codexHome } }).status).toBe('configured');

    writeFileSync(
      join(codexHome, 'hooks.json'),
      renderCodexHooksJson(
        buildCodexHooksConfig({
          version: '3.7.0',
          runtimeCliPath: 'C:\\Users\\Admin\\.locus\\bin\\cli.js',
        }),
      ),
      'utf8',
    );

    expect(inspectCodexHooks({ env: { CODEX_HOME: codexHome } }).status).toBe('configured');
  });

  it('does not mark arbitrary text matches as configured hooks', () => {
    const codexHome = makeTempDir();
    writeFileSync(
      join(codexHome, 'hooks.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node noop.js',
                  statusMessage: 'mentions locus-memory@3.7.0 hook codex stop only in text',
                },
              ],
            },
          ],
        },
      }),
      'utf8',
    );

    expect(inspectCodexHooks({ env: { CODEX_HOME: codexHome } }).status).toBe('not configured');
  });

  it('captures Stop last_assistant_message under redacted capture when no rollout file exists', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const stopIo = createIo();

    const exitCode = await runCli(['hook', 'codex', 'stop'], stopIo.io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'sess-stop-msg-1',
        turn_id: 'turn-msg-1',
        cwd: projectDir,
        last_assistant_message: 'Decision: use Postgres advisory locks for cron job coordination.',
      }),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stopIo.stdout.join('\n'))).toEqual({
      continue: true,
      suppressOutput: true,
    });

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const durable = db.all<{ summary: string }>(
        "SELECT summary FROM durable_memories WHERE state = 'active'",
      );
      expect(durable.some((row) => row.summary.includes('advisory locks'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('does not store Stop last_assistant_message text when LOCUS_CODEX_CAPTURE is metadata or off', async () => {
    for (const captureMode of ['metadata', 'off'] as const) {
      const { projectDir, env } = createSandbox();
      const canonicalRoot = resolveProjectRoot(projectDir).root;
      const stopIo = createIo();

      const exitCode = await runCli(['hook', 'codex', 'stop'], stopIo.io, {
        env: {
          ...env,
          LOCUS_CODEX_CAPTURE: captureMode,
          LOCUS_CAPTURE_LEVEL: captureMode,
        },
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: `sess-stop-${captureMode}`,
          turn_id: `turn-${captureMode}`,
          cwd: projectDir,
          last_assistant_message: 'Decision: never persist this secret fallback marker 9918273.',
        }),
      });

      expect(exitCode).toBe(0);
      const { db } = await initStorage(resolveDbPath(canonicalRoot));
      try {
        const rows = db.all<{ payload_json: string }>(
          'SELECT payload_json FROM conversation_events',
        );
        expect(rows.some((row) => row.payload_json.includes('9918273'))).toBe(false);
        const durable = db.all<{ summary: string }>('SELECT summary FROM durable_memories');
        expect(durable.some((row) => row.summary.includes('9918273'))).toBe(false);
      } finally {
        db.close();
      }
    }
  });

  it('captures UserPromptSubmit decision prompts under redacted capture without rollout files and skips metadata/off', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    const promptIo = createIo();
    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], promptIo.io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-prompt-capture-1',
          cwd: projectDir,
          prompt: 'Decision: CODEX-LIVE-V4 используем NATS JetStream для очереди задач.',
        }),
      }),
    ).toBe(0);

    const stopIo = createIo();
    expect(
      await runCli(['hook', 'codex', 'stop'], stopIo.io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-prompt-capture-1',
          turn_id: 'turn-prompt-capture-1',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const durable = db.all<{ summary: string }>(
        "SELECT summary FROM durable_memories WHERE state = 'active'",
      );
      expect(durable.some((row) => row.summary.includes('NATS JetStream'))).toBe(true);
    } finally {
      db.close();
    }

    for (const captureMode of ['metadata', 'off'] as const) {
      const restricted = createSandbox();
      const restrictedRoot = resolveProjectRoot(restricted.projectDir).root;
      const restrictedEnv = {
        ...restricted.env,
        LOCUS_CODEX_CAPTURE: captureMode,
        LOCUS_CAPTURE_LEVEL: captureMode,
      };

      expect(
        await runCli(['hook', 'codex', 'user-prompt-submit'], createIo().io, {
          env: restrictedEnv,
          stdin: JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            session_id: `sess-prompt-${captureMode}`,
            cwd: restricted.projectDir,
            prompt: 'Decision: secret prompt marker 774411 must not be stored.',
          }),
        }),
      ).toBe(0);

      expect(
        await runCli(['hook', 'codex', 'stop'], createIo().io, {
          env: restrictedEnv,
          stdin: JSON.stringify({
            hook_event_name: 'Stop',
            session_id: `sess-prompt-${captureMode}`,
            turn_id: `turn-${captureMode}`,
            cwd: restricted.projectDir,
          }),
        }),
      ).toBe(0);

      const restrictedDb = (await initStorage(resolveDbPath(restrictedRoot))).db;
      try {
        const rows = restrictedDb.all<{ payload_json: string }>(
          'SELECT payload_json FROM conversation_events',
        );
        expect(rows.some((row) => row.payload_json.includes('774411'))).toBe(false);
        const durable = restrictedDb.all<{ summary: string }>(
          'SELECT summary FROM durable_memories',
        );
        expect(durable.some((row) => row.summary.includes('774411'))).toBe(false);
      } finally {
        restrictedDb.close();
      }
    }
  });

  it('captures Codex 0.171 exec tool in PostToolUse with silent empty stdout', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;
    const postIo = createIo();

    const exitCode = await runCli(['hook', 'codex', 'post-tool-use'], postIo.io, {
      env,
      stdin: JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 'sess-exec-1',
        call_id: 'call_exec_0171',
        cwd: projectDir,
        tool_name: 'exec',
        tool_input: { cmd: 'Write-Output LOCUS-POST-TOOL-PROBE' },
      }),
    });

    expect(exitCode).toBe(0);
    expect(postIo.stderr).toEqual([]);
    expect(postIo.stdout).toEqual([]);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-exec-1',
          turn_id: 'turn-exec-1',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const toolRows = db.all<{ payload_json: string }>(
        "SELECT payload_json FROM conversation_events WHERE kind = 'tool_use'",
      );
      expect(toolRows.some((row) => row.payload_json.includes('"tool":"exec"'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('deduplicates Session 2 echoed assistant decision across two live Codex sessions', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    // Session 1: decision prompt -> Stop
    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-echo-1',
          cwd: projectDir,
          prompt: 'Decision: CODEX-LIVE-V4-FIX2 используем NATS JetStream для очереди задач.',
        }),
      }),
    ).toBe(0);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-echo-1',
          turn_id: 'turn-echo-1',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);

    // Session 2: SessionStart -> recall question UserPromptSubmit -> echoed Stop response
    const startIo = createIo();
    expect(
      await runCli(['hook', 'codex', 'session-start'], startIo.io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'sess-echo-2',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);
    expect(startIo.stdout.join('\n')).toContain('NATS JetStream');

    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-echo-2',
          cwd: projectDir,
          prompt: 'Что мы решили по CODEX-LIVE-V4-FIX2? Не вызывай MCP и не читай файлы.',
        }),
      }),
    ).toBe(0);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-echo-2',
          turn_id: 'turn-echo-2',
          cwd: projectDir,
          last_assistant_message:
            'Для CODEX-LIVE-V4-FIX2 решили использовать NATS JetStream как очередь задач.',
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const countRow = db.get<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM durable_memories WHERE state = 'active' AND memory_type = 'decision'",
      );
      expect(countRow?.cnt).toBe(1);
    } finally {
      db.close();
    }
  });

  it('deduplicates multi-sentence Session 1 prompt and Session 2 recall-meta assistant echo', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-fix3-repro-1',
          cwd: projectDir,
          prompt:
            'Decision: CODEX-LIVE-V4-FIX3 используем NATS JetStream для очереди задач. Измени в файле probe.txt строку pending на verified через apply_patch, затем кратко подтверди решение.',
        }),
      }),
    ).toBe(0);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-fix3-repro-1',
          turn_id: 'turn-fix3-repro-1',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-fix3-repro-2',
          turn_id: 'turn-fix3-repro-2',
          cwd: projectDir,
          last_assistant_message:
            'По CODEX-LIVE-V4-FIX3 решили использовать **NATS JetStream для очереди задач**. В переданном контексте решение отмечено как подтверждённое, а статус в `probe.txt` — как изменённый с `pending` на `verified`.',
        }),
      }),
    ).toBe(0);

    const { db } = await initStorage(resolveDbPath(canonicalRoot));
    try {
      const rows = db.all<{ summary: string }>(
        "SELECT summary FROM durable_memories WHERE state = 'active' AND memory_type = 'decision'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.summary).toBe(
        'CODEX-LIVE-V4-FIX3 используем NATS JetStream для очереди задач.',
      );
    } finally {
      db.close();
    }
  });

  it('acts as silent no-op for missing, home, .codex, and non-project folders without creating storage or triggers', async () => {
    const { root, codexHome, storageRoot, env } = createSandbox();
    const nonProjectDir = join(root, 'plain-dir');
    mkdirSync(nonProjectDir, { recursive: true });

    const disallowedPayloads = [
      { hook_event_name: 'Stop', session_id: 'no-ws', turn_id: 't1' },
      { hook_event_name: 'Stop', session_id: 'home-ws', turn_id: 't2', cwd: homedir() },
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'codex-ws',
        cwd: join(homedir(), '.codex'),
        prompt: 'Decision: must not capture ~/.codex',
      },
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'plain-ws',
        cwd: nonProjectDir,
        prompt: 'Decision: must not capture folder without markers',
      },
    ];

    for (const payload of disallowedPayloads) {
      const event = payload.hook_event_name === 'Stop' ? 'stop' : 'user-prompt-submit';
      const res = createIo();
      expect(
        await runCli(['hook', 'codex', event], res.io, {
          env,
          stdin: JSON.stringify(payload),
        }),
      ).toBe(0);
      expect(JSON.parse(res.stdout.join('\n'))).toEqual({ continue: true, suppressOutput: true });
    }

    expect(existsSync(storageRoot)).toBe(false);
    expect(existsSync(join(codexHome, 'locus', 'hook-triggers'))).toBe(false);
  });

  it('writes daily journal Markdown files alongside locus.db on Codex Stop', async () => {
    const { projectDir, env } = createSandbox();
    const canonicalRoot = resolveProjectRoot(projectDir).root;

    expect(
      await runCli(['hook', 'codex', 'user-prompt-submit'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'sess-journal-codex',
          cwd: projectDir,
          prompt: 'Decision: keep Markdown journal synced atomically beside SQLite.',
        }),
      }),
    ).toBe(0);

    expect(
      await runCli(['hook', 'codex', 'stop'], createIo().io, {
        env,
        stdin: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'sess-journal-codex',
          turn_id: 'turn-journal-codex',
          cwd: projectDir,
        }),
      }),
    ).toBe(0);

    const dbPath = resolveDbPath(canonicalRoot);
    const journalDir = resolveJournalDirFromDbPath(dbPath);
    expect(existsSync(join(journalDir, 'INDEX.md'))).toBe(true);
    const mdFiles = readdirSync(journalDir).filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(file));
    expect(mdFiles).toHaveLength(1);
    const dayContent = readFileSync(join(journalDir, mdFiles[0] ?? ''), 'utf8');
    expect(dayContent).toContain('keep Markdown journal synced atomically beside SQLite.');
    expect(readdirSync(journalDir).some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});
