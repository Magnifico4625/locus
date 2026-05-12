import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCodexHooksConfig, renderCodexHooksJson } from '../src/codex/hooks.js';
import { resolveCodexHome } from '../src/codex/paths.js';
import { runCli } from '../src/index.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-doctor-'));
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

describe('codex doctor command', () => {
  it('reports runtime package, paths, cache status, and ownership without mutation', async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(['doctor', 'codex'], io, {
      env: { CODEX_HOME: 'C:/tmp/codex-home' },
      startDir: repoRoot,
      commandRunner: async (command, args) => {
        if (command === 'codex' && args[0] === '--version') {
          return { exitCode: 0, stdout: 'codex-cli 0.125.0\n', stderr: '' };
        }
        if (command === 'codex' && args.join(' ') === 'features list') {
          return { exitCode: 0, stdout: 'hooks stable true\n', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
      readMcpServer: () => ({
        command: 'npx',
        args: ['-y', 'locus-memory@3.6.0', 'mcp'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Codex version: codex-cli 0.125.0');
    expect(stdout.join('\n')).toContain('Runtime package: locus-memory@3.6.0');
    expect(stdout.join('\n')).toContain('Ownership: package-owned');
    expect(stdout.join('\n')).toContain('Cache warming: not attempted by doctor');
    expect(stdout.join('\n')).toContain('first run after cache cleanup requires network');
    expect(stdout.join('\n')).toContain('Hooks: not configured');
  });

  it('detects package-owned MCP config through codex mcp get when no reader is injected', async () => {
    const commands: Array<{
      command: string;
      args: string[];
      options?: { env?: Record<string, string | undefined> };
    }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['doctor', 'codex'], io, {
      env: { CODEX_HOME: 'C:/tmp/codex-home' },
      startDir: repoRoot,
      commandRunner: async (command, args, options) => {
        commands.push({ command, args, options });
        if (command === 'codex' && args[0] === '--version') {
          return { exitCode: 0, stdout: 'codex-cli 0.125.0\n', stderr: '' };
        }
        if (command === 'codex' && args.join(' ') === 'mcp get locus') {
          return {
            exitCode: 0,
            stdout:
              'locus\n  command: npx.cmd\n  args: -y locus-memory@3.6.0 mcp\n  cwd: C:\\Users\\Admin\\.codex\n',
            stderr: '',
          };
        }
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
    });

    expect(exitCode).toBe(0);
    expect(commands.map((entry) => entry.args.join(' '))).toEqual([
      '--version',
      'features list',
      'mcp get locus',
    ]);
    expect(
      commands.every(
        (entry) =>
          entry.options?.env?.CODEX_HOME === resolveCodexHome({ CODEX_HOME: 'C:/tmp/codex-home' }),
      ),
    ).toBe(true);
    expect(stdout.join('\n')).toContain('Ownership: package-owned');
  });

  it('reports configured hooks without mutating hook files', async () => {
    const codexHome = makeTempDir();
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'hooks.json'),
      renderCodexHooksJson(buildCodexHooksConfig({ version: '3.6.0' })),
      'utf8',
    );
    const { io, stdout } = createIo();

    const exitCode = await runCli(['doctor', 'codex'], io, {
      env: { CODEX_HOME: codexHome },
      startDir: repoRoot,
      commandRunner: async (command, args) => {
        if (command === 'codex' && args[0] === '--version') {
          return { exitCode: 0, stdout: 'codex-cli 0.129.0\n', stderr: '' };
        }
        if (command === 'codex' && args.join(' ') === 'features list') {
          return { exitCode: 0, stdout: 'hooks stable true\n', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
      readMcpServer: () => ({
        command: 'npx',
        args: ['-y', 'locus-memory@3.6.0', 'mcp'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Hooks: configured');
    expect(stdout.join('\n')).toContain(join(codexHome, 'hooks.json'));
  });

  it('reports hooks unavailable when Codex does not expose stable hook support', async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(['doctor', 'codex'], io, {
      env: { CODEX_HOME: makeTempDir() },
      startDir: repoRoot,
      commandRunner: async (command, args) => {
        if (command === 'codex' && args[0] === '--version') {
          return { exitCode: 0, stdout: 'codex-cli 0.120.0\n', stderr: '' };
        }
        if (command === 'codex' && args.join(' ') === 'features list') {
          return { exitCode: 0, stdout: 'plugins stable true\n', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Hooks: unavailable');
  });

  it('reports hooks unavailable when Codex features list is unavailable', async () => {
    const codexHome = makeTempDir();
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'hooks.json'),
      renderCodexHooksJson(buildCodexHooksConfig({ version: '3.6.0' })),
      'utf8',
    );
    const { io, stdout } = createIo();

    const exitCode = await runCli(['doctor', 'codex'], io, {
      env: { CODEX_HOME: codexHome },
      startDir: repoRoot,
      commandRunner: async (command, args) => {
        if (command === 'codex' && args[0] === '--version') {
          return { exitCode: 0, stdout: 'codex-cli 0.119.0\n', stderr: '' };
        }
        if (command === 'codex' && args.join(' ') === 'features list') {
          return { exitCode: 1, stdout: '', stderr: 'unknown command' };
        }
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Hooks: unavailable');
  });
});
