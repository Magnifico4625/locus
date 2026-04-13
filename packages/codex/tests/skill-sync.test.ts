import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyCodexSkill,
  resolveCanonicalCodexSkillPath,
  resolveInstalledCodexSkillPath,
} from '../src/skill-sync.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-skill-sync-'));
  tempDirs.push(dir);
  return dir;
}

function withForwardSlashes(pathValue: string): string {
  return pathValue.replaceAll('\\', '/');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('skill sync helpers', () => {
  it('resolves the canonical repo skill path', () => {
    const skillPath = resolveCanonicalCodexSkillPath();

    expect(
      withForwardSlashes(skillPath).endsWith('packages/codex/skills/locus-memory/SKILL.md'),
    ).toBe(true);
  });

  it('resolves the installed skill path from CODEX_HOME', () => {
    const codexHome = makeTempDir();

    expect(resolveInstalledCodexSkillPath({ env: { CODEX_HOME: codexHome } })).toBe(
      join(codexHome, 'skills', 'locus-memory', 'SKILL.md'),
    );
  });

  it('falls back to ~/.codex when CODEX_HOME is missing', () => {
    const installed = resolveInstalledCodexSkillPath({});

    expect(withForwardSlashes(installed).endsWith('.codex/skills/locus-memory/SKILL.md')).toBe(
      true,
    );
  });

  it('copies the canonical skill into the installed Codex skill directory', () => {
    const root = makeTempDir();
    const sourcePath = join(root, 'repo-skill.md');
    const targetPath = join(root, 'installed', 'skills', 'locus-memory', 'SKILL.md');
    writeFileSync(sourcePath, '# canonical skill\n', 'utf8');

    const result = copyCodexSkill({
      sourcePath,
      targetPath,
    });

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(readFileSync(targetPath, 'utf8')).toBe('# canonical skill\n');
  });

  it('refuses to overwrite a locally modified installed skill by default', () => {
    const root = makeTempDir();
    const sourcePath = join(root, 'repo-skill.md');
    const targetPath = join(root, 'installed', 'skills', 'locus-memory', 'SKILL.md');

    mkdirSync(join(root, 'installed', 'skills', 'locus-memory'), { recursive: true });
    writeFileSync(sourcePath, '# canonical skill\n', 'utf8');
    writeFileSync(targetPath, '# local modified skill\n', 'utf8');

    expect(() =>
      copyCodexSkill({
        sourcePath,
        targetPath,
      }),
    ).toThrow(/differs from the canonical skill/i);

    expect(readFileSync(targetPath, 'utf8')).toBe('# local modified skill\n');
  });

  it('overwrites with explicit force and writes a backup file', () => {
    const root = makeTempDir();
    const sourcePath = join(root, 'repo-skill.md');
    const targetPath = join(root, 'installed', 'skills', 'locus-memory', 'SKILL.md');

    mkdirSync(join(root, 'installed', 'skills', 'locus-memory'), { recursive: true });
    writeFileSync(sourcePath, '# canonical skill\n', 'utf8');
    writeFileSync(targetPath, '# local modified skill\n', 'utf8');

    const result = copyCodexSkill({
      sourcePath,
      targetPath,
      overwrite: true,
      backup: true,
    });

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBe(`${targetPath}.bak`);
    expect(readFileSync(targetPath, 'utf8')).toBe('# canonical skill\n');
    expect(readFileSync(`${targetPath}.bak`, 'utf8')).toBe('# local modified skill\n');
  });

  it('supports the node sync script end-to-end', () => {
    const root = makeTempDir();
    const codexHome = join(root, 'codex-home');
    mkdirSync(codexHome, { recursive: true });

    const output = execFileSync('node', ['scripts/sync-codex-skill.mjs'], {
      cwd: join(import.meta.dirname, '..', '..', '..'),
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
      },
      encoding: 'utf8',
    });

    const installedSkillPath = join(codexHome, 'skills', 'locus-memory', 'SKILL.md');
    expect(output).toContain('Installed skill:');
    expect(readFileSync(installedSkillPath, 'utf8')).toContain(
      '# Locus -- Persistent Project Memory',
    );
  });
});
