import {
  type CodexMcpServerConfig,
  classifyMcpOwnership,
  parseCodexMcpGetOutput,
} from '../codex/config.js';
import { inspectCodexHooks } from '../codex/hooks.js';
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
  const hookFeature = await options.commandRunner('codex', ['features', 'list']);
  const config =
    options.readMcpServer?.() ??
    parseCodexMcpGetOutput((await options.commandRunner('codex', ['mcp', 'get', 'locus'])).stdout);
  const ownership = classifyMcpOwnership(config);
  const hooks = inspectCodexHooks({ env });
  const hookStatus =
    hookFeature.exitCode === 0 && !codexSupportsHooks(hookFeature.stdout)
      ? 'unavailable'
      : hooks.status;

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
    `Hooks: ${hookStatus}`,
    `Hooks path: ${hooks.path}`,
  ].join('\n');
}

function codexSupportsHooks(featuresList: string): boolean {
  return /^hooks\s+\S+\s+true\s*$/imu.test(featuresList);
}
