import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCanonicalCodexSkillPath } from '@locus/codex';
import { resolveCodexSkillPath } from './paths.js';
import type { InstallOperation, PermissionError } from './report.js';

export interface InstallCodexSkillOptions {
  env?: Record<string, string | undefined>;
  sourcePath?: string;
  overwrite?: boolean;
  backup?: boolean;
  now?: Date;
  writeFile?: typeof writeFileSync;
}

export interface InstallCodexSkillResult extends InstallOperation {
  targetPath: string;
  backup?: InstallOperation;
  error?: PermissionError;
}

export function installCodexSkill(options: InstallCodexSkillOptions = {}): InstallCodexSkillResult {
  const sourcePath = options.sourcePath ?? resolvePackagedCodexSkillPath();
  const targetPath = resolveCodexSkillPath(options.env, 'locus-memory');
  const sourceContent = readFileSync(sourcePath, 'utf8');

  try {
    mkdirSync(dirname(targetPath), { recursive: true });

    if (existsSync(targetPath)) {
      const targetContent = readFileSync(targetPath, 'utf8');
      if (targetContent === sourceContent) {
        return { action: 'unchanged', path: targetPath, targetPath };
      }

      if (!options.overwrite) {
        return {
          action: 'skipped',
          path: targetPath,
          targetPath,
          message: 'Installed Codex skill differs; rerun with overwrite enabled.',
        };
      }

      const backup = options.backup
        ? backupSkill(targetPath, options.now ?? new Date())
        : undefined;
      writeAtomically(targetPath, sourceContent, options.writeFile);
      return {
        action: 'updated',
        path: targetPath,
        targetPath,
        backup,
      };
    }

    writeAtomically(targetPath, sourceContent, options.writeFile);
    return { action: 'created', path: targetPath, targetPath };
  } catch (error) {
    return {
      action: 'skipped',
      path: targetPath,
      targetPath,
      error: {
        code: isPermissionError(error) ? 'permission_denied' : 'permission_denied',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function resolvePackagedCodexSkillPath(): string {
  const candidates = [
    resolveCanonicalCodexSkillPath(),
    fileURLToPath(new URL('../packages/codex/skills/locus-memory/SKILL.md', import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? resolveCanonicalCodexSkillPath();
}

function backupSkill(targetPath: string, now: Date): InstallOperation {
  const backupPath = `${targetPath}.${timestamp(now)}.bak`;
  copyFileSync(targetPath, backupPath);
  return {
    action: 'backed_up',
    path: backupPath,
  };
}

function writeAtomically(
  targetPath: string,
  content: string,
  writeFile: typeof writeFileSync = writeFileSync,
): void {
  const tempPath = `${targetPath}.locus-tmp`;
  writeFile(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM';
}
