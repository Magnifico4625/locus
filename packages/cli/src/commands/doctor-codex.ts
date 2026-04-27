import { type CodexMcpServerConfig, classifyMcpOwnership } from '../codex/config.js';
import { resolveCodexConfigPath, resolveCodexHome, resolveCodexSkillPath } from '../codex/paths.js';
import { buildRuntimePackageSpecifier, resolvePackageVersion } from '../package-info.js';
import type { CommandRunner } from './runner.js';

export interface DoctorCodexOptions {
  env?: Record<string, string | undefined>;
  startDir?: string;
  commandRunner: CommandRunner;
  readMcpServer?: () => CodexMcpServerConfig | undefined;
}

export async function formatDoctorCodex(options: DoctorCodexOptions): Promise<string> {
  const env = options.env ?? process.env;
  const version = resolvePackageVersion(options.startDir);
  const codexVersion = await options.commandRunner('codex', ['--version']);
  const ownership = classifyMcpOwnership(options.readMcpServer?.());

  return [
    'Locus Codex doctor',
    `Node version: ${process.version}`,
    `Codex version: ${codexVersion.exitCode === 0 ? codexVersion.stdout.trim() : 'unavailable'}`,
    `Codex home: ${resolveCodexHome(env)}`,
    `Codex config: ${resolveCodexConfigPath(env)}`,
    `Skill path: ${resolveCodexSkillPath(env, 'locus-memory')}`,
    `Runtime package: ${buildRuntimePackageSpecifier(version)}`,
    'Cache warming: not attempted by doctor',
    'Network: first run after cache cleanup requires network access',
    `Ownership: ${ownership}`,
  ].join('\n');
}
