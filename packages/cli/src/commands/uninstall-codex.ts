import { buildCodexMcpRemoveArgs } from '../codex/commands.js';
import {
  type CodexMcpServerConfig,
  classifyMcpOwnership,
  parseCodexMcpGetOutput,
} from '../codex/config.js';
import { resolveCodexSkillPath } from '../codex/paths.js';
import type { CommandRunner } from './runner.js';

export interface UninstallCodexOptions {
  env?: Record<string, string | undefined>;
  commandRunner: CommandRunner;
  readMcpServer?: () => CodexMcpServerConfig | undefined;
}

export async function runUninstallCodex(options: UninstallCodexOptions): Promise<{
  exitCode: number;
  output: string;
}> {
  const config =
    options.readMcpServer?.() ??
    parseCodexMcpGetOutput((await options.commandRunner('codex', ['mcp', 'get', 'locus'])).stdout);
  const ownership = classifyMcpOwnership(config);
  const lines = [`Ownership: ${ownership}`];

  if (ownership === 'package-owned') {
    const result = await options.commandRunner('codex', buildCodexMcpRemoveArgs('locus'));
    if (result.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [`Failed to remove Codex MCP entry: ${result.stderr.trim()}`].join('\n'),
      };
    }
    lines.push('MCP entry removed: locus');
  } else {
    lines.push('MCP entry not removed automatically.');
  }

  lines.push(`Skill preserved: ${resolveCodexSkillPath(options.env, 'locus-memory')}`);
  lines.push('Memory data untouched.');

  return { exitCode: 0, output: lines.join('\n') };
}
