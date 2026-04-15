import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return resolve(fileURLToPath(new URL('../skills/locus-memory/SKILL.md', import.meta.url)));
}

export function resolveInstalledCodexSkillPath(
  options: ResolveInstalledCodexSkillPathOptions = {},
): string {
  const skillName = options.skillName?.trim() || 'locus-memory';
  return join(resolveCodexHomeForSkillSync(options.env), 'skills', skillName, 'SKILL.md');
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

function resolveCodexHomeForSkillSync(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.CODEX_HOME;
  if (configured && configured.trim().length > 0) {
    return resolve(expandTilde(configured));
  }

  return join(homedir(), '.codex');
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
