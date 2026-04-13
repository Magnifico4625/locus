import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodexHome } from './paths.js';

export interface ResolveInstalledCodexSkillPathOptions {
  env?: Record<string, string | undefined>;
  skillName?: string;
}

export interface SkillSyncOptions {
  sourcePath?: string;
  targetPath?: string;
  env?: Record<string, string | undefined>;
  overwrite?: boolean;
  backup?: boolean;
}

export interface SkillSyncResult {
  sourcePath: string;
  targetPath: string;
  changed: boolean;
  backupPath?: string;
}

export function resolveCanonicalCodexSkillPath(): string {
  return resolve(
    fileURLToPath(new URL('../skills/locus-memory/SKILL.md', import.meta.url)),
  );
}

export function resolveInstalledCodexSkillPath(
  options: ResolveInstalledCodexSkillPathOptions = {},
): string {
  const skillName = options.skillName?.trim() || 'locus-memory';
  return join(resolveCodexHome(options.env), 'skills', skillName, 'SKILL.md');
}

export function copyCodexSkill(options: SkillSyncOptions = {}): SkillSyncResult {
  const sourcePath = resolve(options.sourcePath ?? resolveCanonicalCodexSkillPath());
  const targetPath = resolve(targetPathOrDefault(options));
  const sourceContent = readFileSync(sourcePath, 'utf8');

  mkdirSync(dirname(targetPath), { recursive: true });

  let backupPath: string | undefined;
  if (existsSync(targetPath)) {
    const targetContent = readFileSync(targetPath, 'utf8');
    if (targetContent === sourceContent) {
      return {
        sourcePath,
        targetPath,
        changed: false,
      };
    }

    if (!options.overwrite) {
      throw new Error(
        `Installed Codex skill differs from the canonical skill: ${targetPath}. Re-run with overwrite enabled to replace it.`,
      );
    }

    if (options.backup) {
      backupPath = `${targetPath}.bak`;
      copyFileSync(targetPath, backupPath);
    }
  }

  copyFileSync(sourcePath, targetPath);

  return {
    sourcePath,
    targetPath,
    changed: true,
    backupPath,
  };
}

function targetPathOrDefault(options: SkillSyncOptions): string {
  if (options.targetPath) {
    return options.targetPath;
  }

  return resolveInstalledCodexSkillPath({ env: options.env });
}
