import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;
}

describe('version consistency', () => {
  it('keeps root, workspace, lockfile, and plugin versions aligned before release bump', () => {
    const rootPackage = readJson<{ version?: string }>('package.json');
    const packageLock = readJson<{
      version?: string;
      packages?: Record<string, { version?: string }>;
    }>('package-lock.json');
    const versionedFiles = [
      'packages/core/package.json',
      'packages/codex/package.json',
      'packages/shared-runtime/package.json',
      'packages/cli/package.json',
      'plugins/locus-memory/.codex-plugin/plugin.json',
    ];

    expect(packageLock.version).toBe(rootPackage.version);
    expect(packageLock.packages?.['']?.version).toBe(rootPackage.version);

    for (const relativePath of versionedFiles) {
      expect(readJson<{ version?: string }>(relativePath).version, relativePath).toBe(
        rootPackage.version,
      );
    }
  });
});
