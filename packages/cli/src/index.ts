import { fileURLToPath } from 'node:url';
import { runMcp } from './commands/mcp.js';
import { resolvePackageVersion } from './package-info.js';

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  startDir?: string;
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
