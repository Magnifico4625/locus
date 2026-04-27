import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveCodexHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env.CODEX_HOME;
  if (configured && configured.trim().length > 0) {
    return resolve(expandTilde(configured));
  }

  return join(homedir(), '.codex');
}

export function resolveCodexConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveCodexHome(env), 'config.toml');
}

export function resolveCodexSkillPath(
  env: Record<string, string | undefined> = process.env,
  skillName = 'locus-memory',
): string {
  return join(resolveCodexHome(env), 'skills', skillName, 'SKILL.md');
}

function expandTilde(pathValue: string): string {
  if (pathValue === '~') {
    return homedir();
  }

  if (pathValue.startsWith('~/') || pathValue.startsWith('~\\')) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}
