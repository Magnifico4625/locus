import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireInstallLock } from '../src/codex/lock.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-lock-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex install lock', () => {
  it('prevents concurrent installers from mutating the same Codex home', () => {
    const codexHome = makeTempDir();
    const lock = acquireInstallLock(codexHome);

    expect(lock.acquired).toBe(true);
    expect(acquireInstallLock(codexHome).acquired).toBe(false);

    lock.release?.();
    expect(acquireInstallLock(codexHome).acquired).toBe(true);
  });

  it('detects stale lock files with an actionable message', () => {
    const codexHome = makeTempDir();
    const lockPath = join(codexHome, '.locus-install.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999, createdAt: '2026-04-27T00:00:00.000Z' }),
      'utf8',
    );

    const lock = acquireInstallLock(codexHome, {
      now: new Date('2026-04-27T01:00:00.000Z'),
      staleAfterMs: 1,
    });

    expect(lock.acquired).toBe(false);
    expect(lock.reason).toBe('stale');
    expect(lock.message).toMatch(/remove/i);
    expect(readFileSync(lockPath, 'utf8')).toContain('999999');
  });

  it('releases a lock explicitly', () => {
    const codexHome = makeTempDir();
    const lock = acquireInstallLock(codexHome);

    expect(existsSync(join(codexHome, '.locus-install.lock'))).toBe(true);
    lock.release?.();
    expect(existsSync(join(codexHome, '.locus-install.lock'))).toBe(false);
  });
});
