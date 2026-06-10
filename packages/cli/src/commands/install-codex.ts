import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupInterruptedInstall, findInterruptedInstallTempFiles } from '../codex/cleanup.js';
import { buildCodexMcpAddArgs } from '../codex/commands.js';
import {
  classifyMcpOwnership,
  defaultCodexMcpEnv,
  parseCodexMcpGetOutput,
  setMcpServerCwd,
} from '../codex/config.js';
import { installCodexHooks, resolveCodexHooksPath } from '../codex/hooks.js';
import { acquireInstallLock } from '../codex/lock.js';
import { resolveCodexConfigPath, resolveCodexHome, resolveCodexSkillPath } from '../codex/paths.js';
import { installCodexSkill } from '../codex/skill.js';
import {
  buildRuntimePackageSpecifier,
  resolvePackageVersion,
  resolveRuntimePackageOverride,
} from '../package-info.js';
import type { CommandRunner } from './runner.js';

export interface InstallCodexDryRunOptions {
  env?: Record<string, string | undefined>;
  startDir?: string;
  withHooks?: boolean;
}

export interface InstallCodexOptions extends InstallCodexDryRunOptions {
  commandRunner: CommandRunner;
  platform?: NodeJS.Platform;
}

export function formatInstallCodexDryRun(options: InstallCodexDryRunOptions = {}): string {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const skillPath = resolveCodexSkillPath(env, 'locus-memory');
  const runtimePackage = resolveRuntimePackageOverride(env);
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));
  const lockPath = join(codexHome, '.locus-install.lock');
  const tempFiles = findInterruptedInstallTempFiles(codexHome);

  return [
    'Locus Codex install dry-run',
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: ${formatRuntimeCommand(runtimeSpecifier, runtimePackage)}`,
    `MCP cwd: ${codexHome}`,
    `Hooks path: ${resolveCodexHooksPath(env)}`,
    `Hooks: ${options.withHooks ? 'requested (would install)' : 'not requested'}`,
    'Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error',
    `Install lock: ${existsSync(lockPath) ? `present at ${lockPath}` : 'none'}`,
    `Stale temp files: ${tempFiles.length}`,
  ].join('\n');
}

export async function runInstallCodex(options: InstallCodexOptions): Promise<{
  exitCode: number;
  output: string;
}> {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const codexCommandOptions = { env: { CODEX_HOME: codexHome } };
  const mcpEnv = { CODEX_HOME: codexHome, ...defaultCodexMcpEnv };
  const version = resolvePackageVersion(options.startDir);
  const runtimeSpecifier = buildRuntimePackageSpecifier(version);
  const runtimePackage = resolveRuntimePackageOverride(env);
  const lock = acquireInstallLock(codexHome);

  if (!lock.acquired) {
    return {
      exitCode: 1,
      output: lock.message ?? `Could not acquire install lock: ${lock.path}`,
    };
  }

  try {
    const cleanup = cleanupInterruptedInstall(codexHome);
    const cacheResult = await options.commandRunner(
      'npm',
      buildRuntimeAvailabilityArgs(runtimeSpecifier, runtimePackage),
      { cwd: codexHome, env: { CODEX_HOME: codexHome } },
    );

    if (cacheResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          `Runtime package unavailable: ${runtimePackage ?? runtimeSpecifier}`,
          'No Codex MCP config was changed.',
          'This is expected before the package is published to npm unless it already exists in the npm cache.',
          cacheResult.stderr.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    const existing = await options.commandRunner(
      'codex',
      ['mcp', 'get', 'locus'],
      codexCommandOptions,
    );
    const ownership = classifyMcpOwnership(
      existing.exitCode === 0 ? parseCodexMcpGetOutput(existing.stdout) : undefined,
    );

    if (ownership === 'foreign-locus') {
      return {
        exitCode: 1,
        output:
          'Existing MCP entry: foreign-locus\nRefusing to overwrite a non-Locus Codex MCP entry named locus.',
      };
    }

    if (ownership === 'manual-locus' || ownership === 'package-owned') {
      const removeResult = await options.commandRunner(
        'codex',
        ['mcp', 'remove', 'locus'],
        codexCommandOptions,
      );
      if (removeResult.exitCode !== 0) {
        return {
          exitCode: 1,
          output: [
            `Existing MCP entry: ${ownership}`,
            'Partial state: existing MCP entry was not changed because removal failed.',
            removeResult.stderr.trim(),
          ].join('\n'),
        };
      }
    }

    const addResult = await options.commandRunner(
      'codex',
      buildCodexMcpAddArgs({
        name: 'locus',
        version,
        runtimePackage,
        platform: options.platform,
        env: mcpEnv,
      }),
      codexCommandOptions,
    );

    if (addResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          'Partial state: no skill was installed because Codex MCP configuration failed.',
          `Remediation: codex mcp add locus -- ${formatRuntimeCommand(
            runtimeSpecifier,
            runtimePackage,
          )}`,
          addResult.stderr.trim(),
        ].join('\n'),
      };
    }

    const cwdResult = setMcpServerCwd(resolveCodexConfigPath(env), 'locus', codexHome);
    const skill = installCodexSkill({ env, overwrite: true, backup: true });
    const hooks = options.withHooks
      ? installCodexHooks({ env, version, platform: options.platform })
      : undefined;

    return {
      exitCode: skill.error ? 1 : 0,
      output: [
        'Locus Codex install complete',
        `Existing MCP entry: ${ownership}`,
        `Cleanup: removed ${cleanup.removed.length} stale temp file(s)`,
        `MCP: ${addResult.exitCode === 0 ? 'configured' : 'failed'}`,
        `MCP cwd: ${cwdResult.action === 'updated' ? codexHome : 'not updated'}`,
        cwdResult.backupPath ? `Config backup: ${cwdResult.backupPath}` : undefined,
        `Runtime cache: ${cacheResult.exitCode === 0 ? 'warmed' : 'skipped'}`,
        `Skill: ${skill.action}`,
        `Skill path: ${skill.targetPath}`,
        skill.backup ? `Backup: ${skill.backup.path}` : undefined,
        hooks ? `Hooks: ${hooks.action}` : 'Hooks: not requested',
        hooks ? `Hooks path: ${hooks.path}` : undefined,
        hooks?.backupPath ? `Hooks backup: ${hooks.backupPath}` : undefined,
        skill.error ? `Error: ${skill.error.message}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    };
  } finally {
    lock.release?.();
  }
}

function buildRuntimeAvailabilityArgs(runtimeSpecifier: string, runtimePackage?: string): string[] {
  if (runtimePackage) {
    return ['exec', '--yes', '--package', runtimePackage, '--', 'locus-memory', '--help'];
  }

  return ['exec', '-y', runtimeSpecifier, '--', '--help'];
}

function formatRuntimeCommand(runtimeSpecifier: string, runtimePackage?: string): string {
  if (runtimePackage) {
    return `npm exec --yes --package ${runtimePackage} -- locus-memory mcp`;
  }

  return `npx -y ${runtimeSpecifier} mcp`;
}
