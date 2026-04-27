import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = async (command, args) => {
  try {
    const [resolvedCommand, resolvedArgs] = resolveCommandForPlatform(command, args);
    const result = await execFileAsync(resolvedCommand, resolvedArgs, {
      encoding: 'utf8',
      windowsHide: true,
    });

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? execError.message,
    };
  }
};

export function resolveCommandForPlatform(command: string, args: string[]): [string, string[]] {
  if (process.platform !== 'win32') {
    return [command, args];
  }

  return [
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', buildWindowsCommandLine(command, args)],
  ];
}

export function buildWindowsCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

function quoteWindowsArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '\\"')}"`;
}
