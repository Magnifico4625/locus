import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAntigravityPluginDir } from '../antigravity/paths.js';

export interface UninstallAntigravityOptions {
  env?: Record<string, string | undefined>;
  targetDir?: string;
}

export function runUninstallAntigravity(options: UninstallAntigravityOptions = {}): {
  exitCode: number;
  output: string;
} {
  const env = options.env ?? process.env;
  const pluginDir = options.targetDir?.trim() || resolveAntigravityPluginDir(env);

  if (!existsSync(pluginDir)) {
    return {
      exitCode: 0,
      output: [
        `Locus Antigravity plugin is not installed at ${pluginDir}.`,
        'Memory data untouched.',
      ].join('\n'),
    };
  }

  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) {
    return {
      exitCode: 1,
      output: `Refusing to remove ${pluginDir}: missing plugin.json.`,
    };
  }

  let manifestName: unknown;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    manifestName = parsed.name;
  } catch {
    return {
      exitCode: 1,
      output: `Refusing to remove ${pluginDir}: unreadable plugin.json.`,
    };
  }

  if (manifestName !== 'locus-memory') {
    return {
      exitCode: 1,
      output: `Refusing to remove foreign plugin at ${pluginDir} (plugin.json name is "${String(manifestName)}").`,
    };
  }

  rmSync(pluginDir, { recursive: true, force: true });

  return {
    exitCode: 0,
    output: [`Locus Antigravity plugin removed: ${pluginDir}`, 'Memory data untouched.'].join('\n'),
  };
}
