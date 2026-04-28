import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

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
        return { exitCode: 1, stdout: '', stderr: 'not configured' };
      },
      readMcpServer: () => ({
        command: 'npx',
        args: ['-y', 'locus-memory@3.5.1', 'mcp'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Codex version: codex-cli 0.125.0');
    expect(stdout.join('\n')).toContain('Runtime package: locus-memory@3.5.1');
    expect(stdout.join('\n')).toContain('Ownership: package-owned');
    expect(stdout.join('\n')).toContain('Cache warming: not attempted by doctor');
    expect(stdout.join('\n')).toContain('first run after cache cleanup requires network');
  });
});
