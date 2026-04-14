import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  return join(import.meta.dirname, '..', '..', '..');
}

function readJson(pathValue: string): unknown {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

describe('codex plugin bundle', () => {
  it('includes the required local plugin bundle files', () => {
    const root = repoRoot();

    expect(existsSync(join(root, 'plugins', 'locus-memory'))).toBe(true);
    expect(existsSync(join(root, 'plugins', 'locus-memory', '.codex-plugin', 'plugin.json'))).toBe(
      true,
    );
    expect(existsSync(join(root, 'plugins', 'locus-memory', '.mcp.json'))).toBe(true);
    expect(
      existsSync(join(root, 'plugins', 'locus-memory', 'skills', 'locus-memory', 'SKILL.md')),
    ).toBe(true);
  });

  it('registers the plugin in the repo marketplace with a ./plugins/locus-memory path', () => {
    const root = repoRoot();
    const marketplacePath = join(root, '.agents', 'plugins', 'marketplace.json');

    expect(existsSync(marketplacePath)).toBe(true);

    const marketplace = JSON.stringify(readJson(marketplacePath));
    expect(marketplace).toContain('./plugins/locus-memory');
  });

  it('keeps the plugin skill byte-equal to the canonical codex skill', () => {
    const root = repoRoot();
    const canonicalSkill = readFileSync(
      join(root, 'packages', 'codex', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );
    const pluginSkill = readFileSync(
      join(root, 'plugins', 'locus-memory', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );

    expect(pluginSkill).toBe(canonicalSkill);
  });

  it('ships an .mcp.json with a locus server definition and safe default env values', () => {
    const root = repoRoot();
    const pluginMcpPath = join(root, 'plugins', 'locus-memory', '.mcp.json');

    expect(existsSync(pluginMcpPath)).toBe(true);

    const mcpJson = JSON.stringify(readJson(pluginMcpPath));
    expect(mcpJson).toContain('"locus"');
    expect(mcpJson).toContain('"LOCUS_LOG":"error"');
    expect(mcpJson).toContain('"LOCUS_CODEX_CAPTURE":"metadata"');
    expect(mcpJson).toContain('"LOCUS_CAPTURE_LEVEL":"metadata"');
  });

  it('uses plugin-relative ./ paths in plugin.json', () => {
    const root = repoRoot();
    const pluginManifestPath = join(
      root,
      'plugins',
      'locus-memory',
      '.codex-plugin',
      'plugin.json',
    );

    expect(existsSync(pluginManifestPath)).toBe(true);

    const pluginManifest = readJson(pluginManifestPath) as {
      skills?: string;
      mcpServers?: string;
      name?: string;
    };
    expect(pluginManifest.name).toBe('locus-memory');
    expect(pluginManifest.skills).toBe('./skills/');
    expect(pluginManifest.mcpServers).toBe('./.mcp.json');
  });

  it('sync:codex-plugin restores the canonical skill into the plugin bundle', () => {
    writeFileSync(
      join(repoRoot(), 'plugins', 'locus-memory', 'skills', 'locus-memory', 'SKILL.md'),
      '# drifted plugin skill\n',
      'utf8',
    );

    const output = execFileSync('node', ['scripts/sync-codex-plugin.mjs'], {
      cwd: repoRoot(),
      env: process.env,
      encoding: 'utf8',
    });

    const canonicalSkill = readFileSync(
      join(repoRoot(), 'packages', 'codex', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );
    const pluginSkill = readFileSync(
      join(repoRoot(), 'plugins', 'locus-memory', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );

    expect(output).toContain('Plugin skill synced:');
    expect(pluginSkill).toBe(canonicalSkill);
  });

  it('keeps the marketplace source path exact and local', () => {
    const root = repoRoot();
    const marketplace = readJson(join(root, '.agents', 'plugins', 'marketplace.json')) as {
      plugins?: Array<{
        name?: string;
        source?: {
          source?: string;
          path?: string;
        };
      }>;
    };

    const locusEntry = marketplace.plugins?.find((plugin) => plugin.name === 'locus-memory');

    expect(locusEntry?.source?.source).toBe('local');
    expect(locusEntry?.source?.path).toBe('./plugins/locus-memory');
  });

  it('keeps safe default env values in .mcp.json', () => {
    const root = repoRoot();
    const pluginMcp = readJson(join(root, 'plugins', 'locus-memory', '.mcp.json')) as {
      mcpServers?: {
        locus?: {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        };
      };
    };

    expect(pluginMcp.mcpServers?.locus?.command).toBe('node');
    expect(pluginMcp.mcpServers?.locus?.args).toEqual(['../../dist/server.js']);
    expect(pluginMcp.mcpServers?.locus?.env).toEqual({
      LOCUS_LOG: 'error',
      LOCUS_CODEX_CAPTURE: 'metadata',
      LOCUS_CAPTURE_LEVEL: 'metadata',
    });
  });
});
