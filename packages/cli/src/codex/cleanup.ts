import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface CleanupResult {
  removed: string[];
}

export function cleanupInterruptedInstall(codexHome: string): CleanupResult {
  const removed: string[] = [];
  const skillDir = join(codexHome, 'skills', 'locus-memory');

  if (!existsSync(skillDir)) {
    return { removed };
  }

  for (const entry of readdirSync(skillDir)) {
    if (!entry.endsWith('.locus-tmp')) {
      continue;
    }

    const path = join(skillDir, entry);
    if (!statSync(path).isFile()) {
      continue;
    }

    rmSync(path, { force: true });
    removed.push(path);
  }

  return { removed };
}
