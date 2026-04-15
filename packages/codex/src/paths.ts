import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ResolveCodexSessionsDirOptions {
  sessionsDir?: string;
  env?: Record<string, string | undefined>;
}

export function resolveCodexHome(env: Record<string, string | undefined> = process.env): string {
  const configured = env.CODEX_HOME;
  if (configured && configured.trim().length > 0) {
    return resolve(expandTilde(configured));
  }

  return join(homedir(), '.codex');
}

export function resolveCodexSessionsDir(options: ResolveCodexSessionsDirOptions = {}): string {
  if (options.sessionsDir && options.sessionsDir.trim().length > 0) {
    return resolve(expandTilde(options.sessionsDir));
  }

  return join(resolveCodexHome(options.env), 'sessions');
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
