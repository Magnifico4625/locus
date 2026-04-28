import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupInterruptedInstall, findInterruptedInstallTempFiles } from '../codex/cleanup.js';
import { buildCodexMcpAddArgs } from '../codex/commands.js';
import { classifyMcpOwnership, parseCodexMcpGetOutput, setMcpServerCwd } from '../codex/config.js';
import { acquireInstallLock } from '../codex/lock.js';
import { resolveCodexConfigPath, resolveCodexHome, resolveCodexSkillPath } from '../codex/paths.js';
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
  const lockPath = join(codexHome, '.locus-install.lock');
  const tempFiles = findInterruptedInstallTempFiles(codexHome);

  return [
    'Locus Codex install dry-run',
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: npx -y ${runtimeSpecifier} mcp`,
    `MCP cwd: ${codexHome}`,
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
    const cacheResult = await options.commandRunner('npm', [
      'exec',
      '-y',
      runtimeSpecifier,
      '--',
      '--help',
    ]);

    if (cacheResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          `Runtime package unavailable: ${runtimeSpecifier}`,
          'No Codex MCP config was changed.',
          'This is expected before the package is published to npm unless it already exists in the npm cache.',
          cacheResult.stderr.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    const existing = await options.commandRunner('codex', ['mcp', 'get', 'locus']);
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
      const removeResult = await options.commandRunner('codex', ['mcp', 'remove', 'locus']);
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

    const cwdResult = setMcpServerCwd(resolveCodexConfigPath(env), 'locus', codexHome);
    const skill = installCodexSkill({ env, overwrite: true, backup: true });

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
        skill.error ? `Error: ${skill.error.message}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    };
  } finally {
    lock.release?.();
  }
}
