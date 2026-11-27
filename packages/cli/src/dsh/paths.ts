import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveLocusHome } from '@locus/shared-runtime';

export const DSH_PLUGIN_PACKAGE_NAME = 'locus-memory-dsh';
export const DSH_DEFAULT_PROFILE = 'desktop';

function expandLeadingTilde(value: string): string {
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function validateDshProfileName(profile: string): string {
  const trimmed = profile.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed === 'node_modules'
  ) {
    throw new Error(`Invalid DeepSeek Harness profile name: ${JSON.stringify(profile)}`);
  }
  return trimmed;
}

export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const override = env.DSH_HOME?.trim();
  if (override) {
    return expandLeadingTilde(override);
  }
  return join(homedir(), '.dsh');
}

export function resolveDshProfileDir(
  profile = DSH_DEFAULT_PROFILE,
  env: Record<string, string | undefined> = process.env,
): string {
  const safeProfile = validateDshProfileName(profile);
  return join(resolveDshHome(env), 'profiles', safeProfile);
}

export function resolveDshCanonicalPluginDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveLocusHome(env), 'plugins', 'dsh', DSH_PLUGIN_PACKAGE_NAME);
}

export function resolveDshProfilePluginDir(
  profile = DSH_DEFAULT_PROFILE,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveDshProfileDir(profile, env), 'node_modules', DSH_PLUGIN_PACKAGE_NAME);
}

export function resolveDshNodeExecutable(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const primaryRuntime = env.DSH_PRIMARY_RUNTIME?.trim();
  if (primaryRuntime) {
    const exeName = platform === 'win32' ? 'node.exe' : 'node';
    const candidate = join(
      expandLeadingTilde(primaryRuntime),
      'dependencies',
      'node',
      'bin',
      exeName,
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'node';
}
