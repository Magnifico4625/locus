import { type Dirent, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export function findCodexRolloutFiles(sessionsDir: string): string[] {
  return collectRolloutFiles(resolve(sessionsDir)).sort();
}

function collectRolloutFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRolloutFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isRolloutJsonl(fullPath)) {
      files.push(resolve(fullPath));
    }
  }

  return files;
}

function isRolloutJsonl(filePath: string): boolean {
  return /^rollout-.*\.jsonl$/.test(basename(filePath));
}
