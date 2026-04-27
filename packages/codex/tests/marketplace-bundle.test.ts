import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const marketplaceRoot = join(root, 'dist', 'marketplace');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('codex marketplace bundle generation', () => {
  it('generates a package-backed marketplace bundle without mutating another repository', () => {
    rmSync(marketplaceRoot, { recursive: true, force: true });

    const output = execFileSync('node', ['scripts/sync-codex-marketplace.mjs'], {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
    });

    const marketplacePath = join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');
    const pluginRoot = join(marketplaceRoot, 'plugins', 'locus-memory');
    const pluginMcpPath = join(pluginRoot, '.mcp.json');
    const pluginSkillPath = join(pluginRoot, 'skills', 'locus-memory', 'SKILL.md');

    expect(output).toContain('Marketplace root:');
    expect(existsSync(marketplacePath)).toBe(true);
    expect(existsSync(pluginRoot)).toBe(true);

    const marketplace = JSON.stringify(readJson<unknown>(marketplacePath));
    expect(marketplace).toContain('./plugins/locus-memory');

    const mcp = readJson<{
      mcpServers?: {
        locus?: {
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        };
      };
    }>(pluginMcpPath);

    expect(['npx', 'npx.cmd']).toContain(mcp.mcpServers?.locus?.command);
    expect(mcp.mcpServers?.locus?.args).toEqual(['-y', 'locus-memory@3.4.0', 'mcp']);
    expect(mcp.mcpServers?.locus?.args?.join(' ')).not.toContain('@latest');
    expect(mcp.mcpServers?.locus?.env).toEqual({
      LOCUS_LOG: 'error',
      LOCUS_CODEX_CAPTURE: 'redacted',
      LOCUS_CAPTURE_LEVEL: 'redacted',
    });

    const canonicalSkill = readFileSync(
      join(root, 'packages', 'codex', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );
    expect(readFileSync(pluginSkillPath, 'utf8')).toBe(canonicalSkill);

    const script = readFileSync(join(root, 'scripts', 'sync-codex-marketplace.mjs'), 'utf8');
    expect(script).not.toMatch(/\bgit\s+(?:add|commit|push|clone)\b/);
  });
});
