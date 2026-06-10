import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexHookCommand,
  buildCodexHooksConfig,
  inspectCodexHooks,
  renderCodexHooksJson,
} from '../src/codex/hooks.js';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];

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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex hook command', () => {
  it.each(['session-start', 'user-prompt-submit', 'stop'])('accepts %s events', async (event) => {
    const codexHome = makeTempDir();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', event], io, {
      env: { CODEX_HOME: codexHome },
      stdin: JSON.stringify({ hook_event_name: event }),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join('\n'))).toMatchObject({ continue: true });
  });

  it('rejects unsupported events', async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'post-tool-use'], io, {
      env: { CODEX_HOME: makeTempDir() },
      stdin: '{}',
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Unsupported Codex hook event');
  });

  it('fails open with valid JSON when Stop receives malformed stdin', async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'stop'], io, {
      env: { CODEX_HOME: makeTempDir() },
      stdin: '{bad json',
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('\n')).toContain('malformed Codex hook input');
    expect(JSON.parse(stdout.join('\n'))).toEqual({ continue: true, suppressOutput: true });
  });

  it('writes a Stop trigger marker atomically without leaving temp files', async () => {
    const codexHome = makeTempDir();
    const { io } = createIo();

    const exitCode = await runCli(['hook', 'codex', 'stop'], io, {
      env: { CODEX_HOME: codexHome },
      stdin: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'session-1',
        turn_id: 'turn-1',
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

  it('does not depend on SQLite, core, or MCP implementation modules', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'commands', 'hook-codex.ts'),
      'utf8',
    );

    expect(source).not.toContain('node:sqlite');
    expect(source).not.toContain('@locus/core');
    expect(source).not.toContain('runMcp');
    expect(source).not.toContain('commands/mcp');
    expect(existsSync(join(import.meta.dirname, '..', 'src', 'commands', 'hook-codex.ts'))).toBe(
      true,
    );
  });
});

describe('codex hook config generation', () => {
  it('generates lifecycle hooks for safe recall freshness triggers', () => {
    const config = buildCodexHooksConfig({ version: '3.7.0' });

    expect(Object.keys(config.hooks).sort()).toEqual(['SessionStart', 'Stop', 'UserPromptSubmit']);
    expect(config.hooks.PostToolUse).toBeUndefined();

    for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop'] as const) {
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

  it('uses event-specific hook command arguments', () => {
    const config = buildCodexHooksConfig({ version: '3.7.0', platform: 'linux' });

    expect(config.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex session-start',
    );
    expect(config.hooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
      'npx -y locus-memory@3.7.0 hook codex user-prompt-submit',
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

  it('inspects configured hooks from installed binary command policy', () => {
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
});
