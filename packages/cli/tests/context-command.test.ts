import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInboxDir } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];
const savedEnv = { ...process.env };

function makeTempDir(prefix = 'locus-context-cli-'): string {
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

afterEach(() => {
  process.env = { ...savedEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('locus-memory context command', () => {
  it('prints session-start and prompt briefs from isolated storage and filters noisy prompts', async () => {
    const root = makeTempDir();
    const projectDir = join(root, 'demo-project');
    const storageRoot = join(root, 'sandbox-memory');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), '{"name":"demo-project","version":"0.2.0"}');

    process.env.LOCUS_STORAGE_ROOT = storageRoot;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;

    const inboxDir = resolveInboxDir(projectDir);
    mkdirSync(inboxDir, { recursive: true });
    const ts = Date.now();
    writeFileSync(
      join(inboxDir, `${ts}-dec.json`),
      JSON.stringify({
        version: 1,
        event_id: 'cli-context-dec-1',
        source: 'antigravity',
        project_root: projectDir,
        session_id: 'sess-cli-1',
        timestamp: ts,
        kind: 'session_end',
        payload: {
          summary: 'Decision: use SQLite for local durable storage.',
        },
      }),
      'utf8',
    );

    const sessionIo = createIo();
    const sessionExit = await runCli(
      ['context', '--mode', 'session-start', '--cwd', projectDir, '--json'],
      sessionIo.io,
      {
        env: {
          LOCUS_STORAGE_ROOT: storageRoot,
          LOCUS_CAPTURE_LEVEL: 'redacted',
        },
      },
    );

    expect(sessionExit).toBe(0);
    expect(sessionIo.stderr).toEqual([]);
    const sessionBrief = JSON.parse(sessionIo.stdout.join('\n')) as {
      mode: string;
      injected: boolean;
      reason: string;
      text: string;
    };
    expect(sessionBrief.mode).toBe('session_start');
    expect(sessionBrief.injected).toBe(true);
    expect(sessionBrief.reason).toBe('ok');
    expect(sessionBrief.text).toContain('SQLite');

    const promptIo = createIo();
    const promptExit = await runCli(
      [
        'context',
        '--mode',
        'prompt',
        '--prompt',
        'What did we decide about local storage database?',
        '--cwd',
        projectDir,
        '--json',
      ],
      promptIo.io,
      {
        env: {
          LOCUS_STORAGE_ROOT: storageRoot,
          LOCUS_CAPTURE_LEVEL: 'redacted',
        },
      },
    );

    expect(promptExit).toBe(0);
    const promptBrief = JSON.parse(promptIo.stdout.join('\n')) as {
      mode: string;
      injected: boolean;
      reason: string;
      text: string;
    };
    expect(promptBrief.mode).toBe('prompt_recall');
    expect(promptBrief.injected).toBe(true);
    expect(promptBrief.text).toContain('SQLite');

    const noisyIo = createIo();
    const noisyExit = await runCli(
      ['context', '--mode', 'prompt', '--prompt', 'да', '--cwd', projectDir, '--json'],
      noisyIo.io,
      {
        env: { LOCUS_STORAGE_ROOT: storageRoot },
      },
    );

    expect(noisyExit).toBe(0);
    const noisyBrief = JSON.parse(noisyIo.stdout.join('\n')) as {
      injected: boolean;
      reason: string;
    };
    expect(noisyBrief.injected).toBe(false);
    expect(noisyBrief.reason).toBe('noise_filtered');
  });

  it('requires --prompt when --mode prompt is used', async () => {
    const { io, stderr } = createIo();
    const exitCode = await runCli(['context', '--mode', 'prompt'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('--prompt');
  });
});
