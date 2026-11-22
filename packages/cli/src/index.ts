import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaptureLevel } from '@locus/core';
import type { CodexMcpServerConfig } from './codex/config.js';
import { runContextCommand } from './commands/context.js';
import { formatDoctorAntigravity } from './commands/doctor-antigravity.js';
import { formatDoctorCodex } from './commands/doctor-codex.js';
import { isAntigravityHookEvent, runAntigravityHook } from './commands/hook-antigravity.js';
import { runCodexHook } from './commands/hook-codex.js';
import {
  formatInstallAntigravityDryRun,
  runInstallAntigravity,
} from './commands/install-antigravity.js';
import { formatInstallCodexDryRun, runInstallCodex } from './commands/install-codex.js';
import { runMcp } from './commands/mcp.js';
import { type CommandRunner, defaultCommandRunner } from './commands/runner.js';
import { runUninstallAntigravity } from './commands/uninstall-antigravity.js';
import { runUninstallCodex } from './commands/uninstall-codex.js';
import { resolvePackageVersion } from './package-info.js';
import { installLocalCliRuntime } from './runtime-install.js';

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  startDir?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  readMcpServer?: () => CodexMcpServerConfig | undefined;
  platform?: NodeJS.Platform;
  stdin?: string;
  sourceDistDir?: string;
}

const usage = `Usage: locus-memory <command>

Commands:
  locus-memory mcp                    Start the Locus MCP server
  locus-memory context                Print zero-call session/prompt memory brief
  locus-memory sync-runtime           Install local runtime binaries to ~/.locus/bin
  locus-memory install antigravity    Install the native Antigravity Desktop plugin
  locus-memory doctor antigravity     Diagnose the Antigravity Desktop plugin
  locus-memory hook antigravity       Run an Antigravity lifecycle hook
  locus-memory uninstall antigravity  Remove the Antigravity Desktop plugin
  locus-memory install codex          Install Locus for Codex
  locus-memory doctor codex           Diagnose the Codex installation
  locus-memory hook codex             Run a Codex lifecycle hook
  locus-memory uninstall codex        Remove Locus from Codex config

Options:
  --help, help     Show this help
  --version        Show package version`;

const contextUsage = `Usage: locus-memory context [--mode session-start|prompt] [--prompt <text>] [--cwd <path>] [--max-tokens <n>] [--json]

Outputs a bounded zero-call project memory brief for session start or prompt recall.`;

const syncRuntimeUsage = `Usage: locus-memory sync-runtime [--json]

Installs local cli.js and server.js runtime binaries into ~/.locus/bin (or $LOCUS_HOME/bin).`;

const installAntigravityUsage = `Usage: locus-memory install antigravity [--dry-run] [--yes] [--target <dir>] [--capture <metadata|redacted|full>]

Installs the native Antigravity Desktop Locus plugin bundle with local runtime and lifecycle hooks.

Options:
  --dry-run        Show planned changes without writing files
  --yes            Non-interactive install confirmation
  --target <dir>   Custom destination plugin directory
  --capture <lvl>  Capture mode for MCP/hooks: metadata | redacted | full (default: redacted)`;

const uninstallAntigravityUsage = `Usage: locus-memory uninstall antigravity --yes [--target <dir>]

Removes the Locus Antigravity Desktop plugin directory while preserving local memory databases.

Options:
  --yes            Confirm removal
  --target <dir>   Custom plugin directory to remove`;

const installCodexUsage = `Usage: locus-memory install codex [--dry-run] [--with-hooks]

Installs Locus into Codex by configuring the package-owned MCP server and skill.

Options:
  --dry-run        Show planned changes without writing files
  --with-hooks     Also install optional Codex lifecycle hooks
  --yes            Accepted for backwards compatibility`;

const uninstallCodexUsage = `Usage: locus-memory uninstall codex --yes

Removes the package-owned Codex MCP entry while preserving skills and memory data.

Options:
  --yes            Confirm removal`;

function readFlagValue(args: readonly string[], flagName: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === flagName) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }
  return undefined;
}

function parseCaptureLevelFlag(raw: string | undefined): CaptureLevel | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === 'metadata' || raw === 'redacted' || raw === 'full') {
    return raw;
  }
  return 'invalid';
}

async function readStdinWhenPiped(maxBytes = 512 * 1024, timeoutMs = 1500): Promise<string> {
  if (process.stdin.isTTY || process.stdin.readableEnded) {
    return '';
  }

  return new Promise<string>((resolveStdin) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', finish);
      process.stdin.off('close', finish);
      process.stdin.off('error', finish);
      resolveStdin(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '');
    };

    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();

    const onData = (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      const remaining = maxBytes - totalBytes;
      if (remaining <= 0) {
        finish();
        return;
      }
      chunks.push(buf.length > remaining ? buf.subarray(0, remaining) : buf);
      totalBytes += Math.min(buf.length, remaining);
      if (totalBytes >= maxBytes) {
        finish();
      }
    };

    process.stdin.on('data', onData);
    process.stdin.once('end', finish);
    process.stdin.once('close', finish);
    process.stdin.once('error', finish);
  });
}

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIo = {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  },
  options: CliOptions = {},
): Promise<number> {
  const [command, subcommand] = argv;

  if (!command || command === '--help' || command === 'help') {
    io.stdout(usage);
    return 0;
  }

  if (command === '--version' || command === 'version') {
    io.stdout(resolvePackageVersion(options.startDir));
    return 0;
  }

  if (command === 'mcp') {
    return runMcp();
  }

  if (command === 'context') {
    if (argv.includes('--help')) {
      io.stdout(contextUsage);
      return 0;
    }

    const rawMaxTokens = readFlagValue(argv, '--max-tokens');
    let maxTokens: number | undefined;
    if (rawMaxTokens !== undefined) {
      const parsed = Number(rawMaxTokens);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        io.stderr('Option --max-tokens must be a positive integer.');
        return 1;
      }
      maxTokens = parsed;
    }

    const result = await runContextCommand({
      mode: readFlagValue(argv, '--mode'),
      prompt: readFlagValue(argv, '--prompt'),
      cwd: readFlagValue(argv, '--cwd'),
      json: argv.includes('--json'),
      maxTokens,
      env: options.env,
    });
    if (result.stdout) {
      io.stdout(result.stdout);
    }
    if (result.stderr) {
      io.stderr(result.stderr);
    }
    return result.exitCode;
  }

  if (command === 'sync-runtime') {
    if (argv.includes('--help')) {
      io.stdout(syncRuntimeUsage);
      return 0;
    }

    try {
      const result = installLocalCliRuntime({
        env: options.env,
        startDir: options.startDir,
        sourceDistDir: options.sourceDistDir,
      });
      if (argv.includes('--json')) {
        io.stdout(JSON.stringify(result));
      } else {
        io.stdout(`Locus local runtime ${result.action} (${result.version}) at ${result.binDir}`);
      }
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === 'hook' && subcommand === 'antigravity') {
    const event = argv[2];
    if (!isAntigravityHookEvent(event)) {
      io.stderr(`Unsupported Antigravity hook event: ${event ?? '(missing)'}`);
      return 1;
    }

    const stdin = options.stdin ?? (await readStdinWhenPiped());
    const result = await runAntigravityHook({
      event,
      stdin,
      env: options.env,
    });
    if (result.stdout) {
      io.stdout(result.stdout);
    }
    if (result.stderr) {
      io.stderr(result.stderr);
    }
    return result.exitCode;
  }

  if (command === 'install' && subcommand === 'antigravity' && argv.includes('--help')) {
    io.stdout(installAntigravityUsage);
    return 0;
  }

  if (command === 'install' && subcommand === 'antigravity') {
    const captureLevel = parseCaptureLevelFlag(readFlagValue(argv, '--capture'));
    if (captureLevel === 'invalid') {
      io.stderr('Option --capture must be one of: metadata, redacted, full.');
      return 1;
    }

    const targetDir = readFlagValue(argv, '--target');
    if (argv.includes('--dry-run')) {
      io.stdout(
        formatInstallAntigravityDryRun({
          env: options.env,
          startDir: options.startDir,
          targetDir,
          captureLevel,
        }),
      );
      return 0;
    }

    const result = runInstallAntigravity({
      env: options.env,
      startDir: options.startDir,
      sourceDistDir: options.sourceDistDir,
      targetDir,
      captureLevel,
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (command === 'doctor' && subcommand === 'antigravity') {
    const result = formatDoctorAntigravity({
      env: options.env,
      targetDir: readFlagValue(argv, '--target'),
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (command === 'uninstall' && subcommand === 'antigravity' && argv.includes('--help')) {
    io.stdout(uninstallAntigravityUsage);
    return 0;
  }

  if (command === 'uninstall' && subcommand === 'antigravity' && argv.includes('--yes')) {
    const result = runUninstallAntigravity({
      env: options.env,
      targetDir: readFlagValue(argv, '--target'),
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (command === 'uninstall' && subcommand === 'antigravity') {
    io.stderr(uninstallAntigravityUsage);
    return 1;
  }

  if (command === 'hook' && subcommand === 'codex') {
    const result = runCodexHook({
      event: argv[2],
      stdin: options.stdin,
      env: options.env,
    });
    if (result.stdout) {
      io.stdout(result.stdout);
    }
    if (result.stderr) {
      io.stderr(result.stderr);
    }
    return result.exitCode;
  }

  if (command === 'install' && subcommand === 'codex' && argv.includes('--help')) {
    io.stdout(installCodexUsage);
    return 0;
  }

  if (command === 'install' && subcommand === 'codex' && argv.includes('--dry-run')) {
    io.stdout(
      formatInstallCodexDryRun({
        env: options.env,
        startDir: options.startDir,
        withHooks: argv.includes('--with-hooks'),
      }),
    );
    return 0;
  }

  if (command === 'install' && subcommand === 'codex') {
    const result = await runInstallCodex({
      env: options.env,
      startDir: options.startDir,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      platform: options.platform,
      withHooks: argv.includes('--with-hooks'),
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (command === 'doctor' && subcommand === 'codex') {
    io.stdout(
      await formatDoctorCodex({
        env: options.env,
        startDir: options.startDir,
        commandRunner: options.commandRunner ?? defaultCommandRunner,
        readMcpServer: options.readMcpServer,
      }),
    );
    return 0;
  }

  if (command === 'uninstall' && subcommand === 'codex' && argv.includes('--help')) {
    io.stdout(uninstallCodexUsage);
    return 0;
  }

  if (command === 'uninstall' && subcommand === 'codex' && argv.includes('--yes')) {
    const result = await runUninstallCodex({
      env: options.env,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      readMcpServer: options.readMcpServer,
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (command === 'uninstall' && subcommand === 'codex') {
    io.stderr(uninstallCodexUsage);
    return 1;
  }

  io.stderr(`Unknown command: ${argv.join(' ')}`);
  io.stderr(usage);
  return 1;
}

function isDirectEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  const selfPath = resolve(fileURLToPath(import.meta.url));
  const entryPath = resolve(entry);
  const normalizeCmp = (value: string) =>
    process.platform === 'win32' ? value.toLowerCase() : value;

  if (normalizeCmp(entryPath) === normalizeCmp(selfPath)) {
    return true;
  }

  try {
    return normalizeCmp(realpathSync(entryPath)) === normalizeCmp(realpathSync(selfPath));
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
