import type { CaptureLevel } from '@locus/core';
import { writeAntigravityPluginBundle } from '../antigravity/bundle.js';
import { resolveAntigravityConfigDir, resolveAntigravityPluginDir } from '../antigravity/paths.js';
import { resolvePackageVersion } from '../package-info.js';
import { installLocalCliRuntime } from '../runtime-install.js';

export interface InstallAntigravityDryRunOptions {
  env?: Record<string, string | undefined>;
  targetDir?: string;
  captureLevel?: CaptureLevel;
  startDir?: string;
}

export interface InstallAntigravityOptions extends InstallAntigravityDryRunOptions {
  sourceDistDir?: string;
  now?: Date;
}

function resolveTargetPluginDir(
  env: Record<string, string | undefined>,
  targetDir?: string,
): { pluginDir: string; isCustomTarget: boolean } {
  const custom = targetDir?.trim();
  if (custom) {
    return { pluginDir: custom, isCustomTarget: true };
  }

  return {
    pluginDir: resolveAntigravityPluginDir(env),
    isCustomTarget: false,
  };
}

export function formatInstallAntigravityDryRun(
  options: InstallAntigravityDryRunOptions = {},
): string {
  const env = options.env ?? process.env;
  const { pluginDir } = resolveTargetPluginDir(env, options.targetDir);
  const captureLevel = options.captureLevel ?? 'redacted';
  const version = resolvePackageVersion(options.startDir);

  return [
    'Locus Antigravity Desktop install dry-run',
    `Version: ${version}`,
    `Config root: ${resolveAntigravityConfigDir(env)}`,
    `Target plugin dir: ${pluginDir}`,
    `Capture level: ${captureLevel}`,
    'Planned bundle files:',
    '  - plugin.json',
    '  - hooks.json (SessionStart, PreInvocation, PostToolUse, Stop)',
    '  - hooks/locus-hook.mjs',
    '  - mcp_config.json',
    '  - rules/AGENTS.md',
    '  - skills/locus-memory/SKILL.md',
    '  - runtime/cli.js',
    '  - runtime/server.js',
    '  - runtime/package.json',
    '  - runtime/runtime.json',
    'Antigravity config.json: untouched (native discovery loads plugins/<name>/)',
  ].join('\n');
}

export function runInstallAntigravity(options: InstallAntigravityOptions = {}): {
  exitCode: number;
  output: string;
} {
  const env = options.env ?? process.env;
  const captureLevel = options.captureLevel ?? 'redacted';
  const { pluginDir, isCustomTarget } = resolveTargetPluginDir(env, options.targetDir);

  const bundleResult = writeAntigravityPluginBundle({
    targetDir: pluginDir,
    startDir: options.startDir,
    sourceDistDir: options.sourceDistDir,
    captureLevel,
    now: options.now,
  });

  const localRuntimeResult = isCustomTarget
    ? undefined
    : installLocalCliRuntime({
        env,
        startDir: options.startDir,
        sourceDistDir: options.sourceDistDir,
        now: options.now,
      });

  return {
    exitCode: 0,
    output: [
      `Locus Antigravity plugin ${bundleResult.action} (${bundleResult.version})`,
      `Plugin dir: ${bundleResult.pluginDir}`,
      `Runtime dir: ${bundleResult.runtimeDir}`,
      `Capture level: ${captureLevel}`,
      localRuntimeResult
        ? `Shared local runtime (${localRuntimeResult.action}): ${localRuntimeResult.binDir}`
        : 'Shared local runtime: skipped (custom --target)',
      'Restart or reload Antigravity plugins if the MCP server was already running.',
    ].join('\n'),
  };
}
