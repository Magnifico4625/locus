import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CleanupResult {
  removed: string[];
}

export function cleanupInterruptedInstall(codexHome: string): CleanupResult {
  const removed: string[] = [];
  const tempFiles = findInterruptedInstallTempFiles(codexHome);

  for (const path of tempFiles) {
    rmSync(path, { force: true });
    removed.push(path);
  }

  return { removed };
}

export function findInterruptedInstallTempFiles(codexHome: string): string[] {
  const skillDir = join(codexHome, 'skills', 'locus-memory');
  const tempFiles: string[] = [];

  if (!existsSync(skillDir)) {
    return tempFiles;
  }

  for (const entry of readdirSync(skillDir)) {
    if (!entry.endsWith('.locus-tmp')) {
      continue;
    }

    const path = join(skillDir, entry);
    if (!statSync(path).isFile()) {
      continue;
    }

    tempFiles.push(path);
  }

  return tempFiles;
}
