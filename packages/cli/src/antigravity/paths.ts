import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveLocusHome } from '@locus/shared-runtime';

export function resolveAntigravityConfigDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.LOCUS_ANTIGRAVITY_CONFIG_DIR?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), '.gemini', 'config');
}

export function resolveAntigravityPluginsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveAntigravityConfigDir(env), 'plugins');
}

export function resolveAntigravityPluginDir(
  env: Record<string, string | undefined> = process.env,
  pluginName = 'locus-memory',
): string {
  return join(resolveAntigravityPluginsDir(env), pluginName);
}

export function resolveAntigravityStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveLocusHome(env), 'state', 'antigravity');
}

export function resolveAntigravitySessionStatePath(
  conversationId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const hash = createHash('sha256').update(conversationId).digest('hex').slice(0, 24);
  return join(resolveAntigravityStateDir(env), `${hash}.json`);
}
