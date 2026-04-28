import { describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

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

describe('codex uninstall command', () => {
  it('removes package-owned MCP config and preserves the skill by default', async () => {
    const commands: Array<{ command: string; args: string[] }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['uninstall', 'codex', '--yes'], io, {
      env: { CODEX_HOME: 'C:/tmp/codex-home' },
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      readMcpServer: () => ({
        command: 'npx',
        args: ['-y', 'locus-memory@3.5.3', 'mcp'],
      }),
    });

    expect(exitCode).toBe(0);
    expect(commands).toEqual([{ command: 'codex', args: ['mcp', 'remove', 'locus'] }]);
    expect(stdout.join('\n')).toContain('Skill preserved:');
  });

  it('detects package-owned MCP config through codex mcp get when no reader is injected', async () => {
    const commands: Array<{ command: string; args: string[] }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['uninstall', 'codex', '--yes'], io, {
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        if (args.join(' ') === 'mcp get locus') {
          return {
            exitCode: 0,
            stdout: 'locus\n  command: npx.cmd\n  args: -y locus-memory@3.5.3 mcp\n',
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(exitCode).toBe(0);
    expect(commands.map((entry) => entry.args.join(' '))).toEqual([
      'mcp get locus',
      'mcp remove locus',
    ]);
    expect(stdout.join('\n')).toContain('Ownership: package-owned');
  });
});
