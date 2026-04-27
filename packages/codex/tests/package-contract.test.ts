import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const bundleBudgets = {
  'dist/cli.js': 400_000,
  'dist/server.js': 3_000_000,
} as const;

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;
}

describe('publishable package contract', () => {
  it('exposes locus-memory as a public npm package with a CLI bin', () => {
    const packageJson = readJson<{
      name?: string;
      private?: boolean;
      main?: string;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    }>('package.json');

    expect(packageJson.name).toBe('locus-memory');
    expect(packageJson.private).toBe(false);
    expect(packageJson.main).toBe('dist/server.js');
    expect(packageJson.bin?.['locus-memory']).toBe('dist/cli.js');
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        'dist/',
        'packages/codex/skills/locus-memory/SKILL.md',
        'LICENSE',
        'README.md',
      ]),
    );
    expect(packageJson.scripts?.prepublishOnly).toContain('npm run check');
    expect(packageJson.scripts?.prepublishOnly).toContain('npm run build');
  });

  it('keeps package-lock root version aligned with package.json', () => {
    const packageJson = readJson<{ version?: string }>('package.json');
    const packageLock = readJson<{
      version?: string;
      packages?: Record<string, { version?: string }>;
    }>('package-lock.json');

    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages?.['']?.version).toBe(packageJson.version);
  });

  it('keeps public workspace and plugin versions aligned early', () => {
    const packageJson = readJson<{ version?: string }>('package.json');
    const rootVersion = packageJson.version;
    const versionedFiles = [
      'packages/core/package.json',
      'packages/codex/package.json',
      'packages/shared-runtime/package.json',
      'plugins/locus-memory/.codex-plugin/plugin.json',
    ];

    for (const relativePath of versionedFiles) {
      expect(readJson<{ version?: string }>(relativePath).version, relativePath).toBe(rootVersion);
    }
  });

  it('builds separate MCP server and CLI entrypoints', () => {
    const esbuildConfig = readFileSync(join(root, 'esbuild.config.ts'), 'utf8');

    expect(esbuildConfig).toContain("packages/core/src/server.ts");
    expect(esbuildConfig).toContain("dist/server.js");
    expect(esbuildConfig).toContain("packages/cli/src/index.ts");
    expect(esbuildConfig).toContain("dist/cli.js");
  });

  it('records bundle size budgets and prevents obvious CLI/server duplication', () => {
    for (const [relativePath, maxBytes] of Object.entries(bundleBudgets)) {
      expect(maxBytes, `${relativePath} must have an explicit byte budget`).toBeGreaterThan(0);

      const absolutePath = join(root, relativePath);
      if (existsSync(absolutePath)) {
        expect(statSync(absolutePath).size, relativePath).toBeLessThanOrEqual(maxBytes);
      }
    }

    const cliPath = join(root, 'dist/cli.js');
    const serverPath = join(root, 'dist/server.js');
    if (existsSync(cliPath) && existsSync(serverPath)) {
      expect(statSync(cliPath).size).toBeLessThan(statSync(serverPath).size);
    }
  });
});
