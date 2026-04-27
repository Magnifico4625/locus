import { cleanupInterruptedInstall } from '../codex/cleanup.js';
import { buildCodexMcpAddArgs } from '../codex/commands.js';
import { acquireInstallLock } from '../codex/lock.js';
import { resolveCodexHome, resolveCodexSkillPath } from '../codex/paths.js';
import { installCodexSkill } from '../codex/skill.js';
import { buildRuntimePackageSpecifier, resolvePackageVersion } from '../package-info.js';
import type { CommandRunner } from './runner.js';

export interface InstallCodexDryRunOptions {
  env?: Record<string, string | undefined>;
  startDir?: string;
}

export interface InstallCodexOptions extends InstallCodexDryRunOptions {
  commandRunner: CommandRunner;
  platform?: NodeJS.Platform;
}

export function formatInstallCodexDryRun(options: InstallCodexDryRunOptions = {}): string {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const skillPath = resolveCodexSkillPath(env, 'locus-memory');
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));

  return [
    'Locus Codex install dry-run',
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: npx -y ${runtimeSpecifier} mcp`,
    'Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error',
  ].join('\n');
}

export async function runInstallCodex(options: InstallCodexOptions): Promise<{
  exitCode: number;
  output: string;
}> {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const version = resolvePackageVersion(options.startDir);
  const runtimeSpecifier = buildRuntimePackageSpecifier(version);
  const lock = acquireInstallLock(codexHome);

  if (!lock.acquired) {
    return {
      exitCode: 1,
      output: lock.message ?? `Could not acquire install lock: ${lock.path}`,
    };
  }

  try {
    const cleanup = cleanupInterruptedInstall(codexHome);
    const addResult = await options.commandRunner(
      'codex',
      buildCodexMcpAddArgs({
        name: 'locus',
        version,
        platform: options.platform,
      }),
    );

    if (addResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          'Partial state: no skill was installed because Codex MCP configuration failed.',
          `Remediation: codex mcp add locus -- npx -y ${runtimeSpecifier} mcp`,
          addResult.stderr.trim(),
        ].join('\n'),
      };
    }

    const cacheResult = await options.commandRunner('npm', [
      'exec',
      '-y',
      runtimeSpecifier,
      '--',
      '--help',
    ]);
    const skill = installCodexSkill({ env, overwrite: true, backup: true });

    return {
      exitCode: skill.error ? 1 : 0,
      output: [
        'Locus Codex install complete',
        `Cleanup: removed ${cleanup.removed.length} stale temp file(s)`,
        `MCP: ${addResult.exitCode === 0 ? 'configured' : 'failed'}`,
        `Runtime cache: ${cacheResult.exitCode === 0 ? 'warmed' : 'skipped'}`,
        `Skill: ${skill.action}`,
        `Skill path: ${skill.targetPath}`,
        skill.backup ? `Backup: ${skill.backup.path}` : undefined,
        skill.error ? `Error: ${skill.error.message}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    };
  } finally {
    lock.release?.();
  }
}
