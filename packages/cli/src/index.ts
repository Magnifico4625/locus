import { fileURLToPath } from 'node:url';
import type { CodexMcpServerConfig } from './codex/config.js';
import { formatDoctorCodex } from './commands/doctor-codex.js';
import { runCodexHook } from './commands/hook-codex.js';
import { formatInstallCodexDryRun, runInstallCodex } from './commands/install-codex.js';
import { runMcp } from './commands/mcp.js';
import { type CommandRunner, defaultCommandRunner } from './commands/runner.js';
import { runUninstallCodex } from './commands/uninstall-codex.js';
import { resolvePackageVersion } from './package-info.js';

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
}

const usage = `Usage: locus-memory <command>

Commands:
  locus-memory mcp              Start the Locus MCP server
  locus-memory install codex    Install Locus for Codex
  locus-memory doctor codex     Diagnose the Codex installation
  locus-memory hook codex       Run a Codex lifecycle hook
  locus-memory uninstall codex  Remove Locus from Codex config

Options:
  --help, help     Show this help
  --version        Show package version`;

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

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
