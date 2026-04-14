import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

function repoRoot(): string {
  return join(import.meta.dirname, '..', '..', '..');
}

function readJson(pathValue: string): unknown {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-plugin-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    const pluginManifestPath = join(root, 'plugins', 'locus-memory', '.codex-plugin', 'plugin.json');

    expect(existsSync(pluginManifestPath)).toBe(true);

    const pluginManifest = JSON.stringify(readJson(pluginManifestPath));
    expect(pluginManifest).toContain('./skills/');
    expect(pluginManifest).toContain('./.mcp.json');
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
});
