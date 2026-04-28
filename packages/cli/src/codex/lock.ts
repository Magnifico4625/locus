import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstallLockOptions {
  now?: Date;
  staleAfterMs?: number;
}

export interface InstallLockResult {
  acquired: boolean;
  path: string;
  reason?: 'active' | 'stale' | 'permission_denied';
  message?: string;
  release?: () => void;
}

const defaultStaleAfterMs = 15 * 60 * 1000;

export function acquireInstallLock(
  codexHome: string,
  options: InstallLockOptions = {},
): InstallLockResult {
  mkdirSync(codexHome, { recursive: true });

  const lockPath = join(codexHome, '.locus-install.lock');
  if (existsSync(lockPath)) {
    const stale = isStaleLock(lockPath, options);
    return {
      acquired: false,
      path: lockPath,
      reason: stale ? 'stale' : 'active',
      message: stale
        ? `Stale Locus install lock found at ${lockPath}. Remove it after confirming no installer is running.`
        : `Another Locus installer is already running: ${lockPath}`,
    };
  }

  try {
    writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          createdAt: (options.now ?? new Date()).toISOString(),
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      acquired: false,
      path: lockPath,
      reason: code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : 'active',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    acquired: true,
    path: lockPath,
    release: () => {
      rmSync(lockPath, { force: true });
    },
  };
}

function isStaleLock(lockPath: string, options: InstallLockOptions): boolean {
  const staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
  const now = options.now ?? new Date();

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { createdAt?: string };
    if (!lock.createdAt) {
      return false;
    }

    return now.getTime() - new Date(lock.createdAt).getTime() > staleAfterMs;
  } catch {
    return false;
  }
}
