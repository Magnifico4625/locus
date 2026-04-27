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

describe('locus-memory cli', () => {
  it('prints help with primary commands', async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(['--help'], io);

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('locus-memory mcp');
    expect(stdout.join('\n')).toContain('install codex');
  });

  it('prints version', async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(['--version'], io, { startDir: import.meta.dirname });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('3.4.0');
  });

  it('rejects unknown commands with concise usage', async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(['wat'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Unknown command: wat');
    expect(stderr.join('\n')).toContain('Usage: locus-memory');
  });

  it('exposes placeholder codex commands before installer implementation', async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(['install', 'codex'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('not implemented');
  });
});
