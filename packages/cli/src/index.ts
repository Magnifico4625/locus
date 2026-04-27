import { fileURLToPath } from 'node:url';
import type { CodexMcpServerConfig } from './codex/config.js';
import { formatDoctorCodex } from './commands/doctor-codex.js';
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
}

const usage = `Usage: locus-memory <command>

Commands:
  locus-memory mcp              Start the Locus MCP server
  locus-memory install codex    Install Locus for Codex
  locus-memory doctor codex     Diagnose the Codex installation
  locus-memory uninstall codex  Remove Locus from Codex config

Options:
  --help, help     Show this help
  --version        Show package version`;

const notImplemented = 'This command is not implemented yet in the current Track B task.';

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

  if (command === 'install' && subcommand === 'codex' && argv.includes('--dry-run')) {
    io.stdout(formatInstallCodexDryRun({ env: options.env, startDir: options.startDir }));
    return 0;
  }

  if (command === 'install' && subcommand === 'codex' && argv.includes('--yes')) {
    const result = await runInstallCodex({
      env: options.env,
      startDir: options.startDir,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      platform: options.platform,
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

  if (command === 'uninstall' && subcommand === 'codex' && argv.includes('--yes')) {
    const result = await runUninstallCodex({
      env: options.env,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      readMcpServer: options.readMcpServer,
    });
    io.stdout(result.output);
    return result.exitCode;
  }

  if (
    (command === 'install' || command === 'doctor' || command === 'uninstall') &&
    subcommand === 'codex'
  ) {
    io.stderr(`${command} codex: ${notImplemented}`);
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
