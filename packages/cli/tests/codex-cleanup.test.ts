import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupInterruptedInstall } from '../src/codex/cleanup.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-cleanup-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex interrupted install cleanup', () => {
  it('removes stale Locus temp files', () => {
    const codexHome = makeTempDir();
    const skillDir = join(codexHome, 'skills', 'locus-memory');
    const tempPath = join(skillDir, 'SKILL.md.locus-tmp');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(tempPath, '# partial\n', 'utf8');

    const result = cleanupInterruptedInstall(codexHome);

    expect(result.removed).toContain(tempPath);
    expect(existsSync(tempPath)).toBe(false);
  });

  it('never removes memory databases or non-Locus files', () => {
    const codexHome = makeTempDir();
    const dbPath = join(codexHome, 'memory.db');
    const randomTmp = join(codexHome, 'random.tmp');
    writeFileSync(dbPath, 'db', 'utf8');
    writeFileSync(randomTmp, 'tmp', 'utf8');

    const result = cleanupInterruptedInstall(codexHome);

    expect(result.removed).toEqual([]);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(randomTmp)).toBe(true);
  });
});
