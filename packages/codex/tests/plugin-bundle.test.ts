import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateCodexMarketplaceBundle } from '../src/plugin-sync.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-bundle-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    expect(existsSync(join(root, 'plugins', 'locus-memory', 'hooks.json'))).toBe(true);
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

  it('ships the Track C recall truth instructions in the bundled skill', () => {
    const root = repoRoot();
    const pluginSkill = readFileSync(
      join(root, 'plugins', 'locus-memory', 'skills', 'locus-memory', 'SKILL.md'),
      'utf8',
    );

    expect(pluginSkill).toContain('candidateGroups');
    expect(pluginSkill).toContain('memory_review');
    expect(pluginSkill).toContain('`metadata` means ingestion and diagnostics first');
    expect(pluginSkill).toContain('`redacted` is the recommended practical rich-recall mode');
    expect(pluginSkill).toContain('`full` is maximum local capture');
    expect(pluginSkill).toContain('Codex Desktop MCP path is validated');
    expect(pluginSkill).toContain('do not claim desktop or extension parity');
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
      hooks?: string;
      name?: string;
    };
    expect(pluginManifest.name).toBe('locus-memory');
    expect(pluginManifest.skills).toBe('./skills/');
    expect(pluginManifest.mcpServers).toBe('./.mcp.json');
    expect(pluginManifest.hooks).toBe('./hooks.json');

    const pluginHooks = readJson(join(root, 'plugins', 'locus-memory', 'hooks.json')) as {
      hooks?: Record<string, unknown>;
    };
    expect(Object.keys(pluginHooks.hooks ?? {}).sort()).toEqual([
      'PostToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
  });

  it('generates self-contained marketplace bundle with local runtime and hooks when bundleRuntime=true', () => {
    const tempRoot = makeTempRoot();
    mkdirSync(join(tempRoot, 'dist'), { recursive: true });
    writeFileSync(join(tempRoot, 'dist', 'cli.js'), 'console.log("cli");\n', 'utf8');
    writeFileSync(join(tempRoot, 'dist', 'server.js'), 'console.log("server");\n', 'utf8');

    const result = generateCodexMarketplaceBundle({
      rootDir: tempRoot,
      version: '4.0.0',
      bundleRuntime: true,
    });

    expect(existsSync(result.hooksPath)).toBe(true);
    expect(result.runtimeDir).toBe(join(result.pluginRoot, 'runtime'));
    expect(existsSync(join(result.runtimeDir ?? '', 'cli.js'))).toBe(true);
    expect(existsSync(join(result.runtimeDir ?? '', 'server.js'))).toBe(true);
    expect(existsSync(join(result.runtimeDir ?? '', 'package.json'))).toBe(true);
    expect(existsSync(join(result.runtimeDir ?? '', 'runtime.json'))).toBe(true);

    const mcp = readJson(result.mcpPath) as {
      mcpServers: { locus: { command: string; args: string[] } };
    };
    expect(mcp.mcpServers.locus.command).toBe('node');
    expect(mcp.mcpServers.locus.args[0]).toBe(join(result.runtimeDir ?? '', 'server.js'));

    const hooks = readJson(result.hooksPath) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(hooks.hooks.Stop[0]?.hooks[0]?.command).toContain(
      join(result.runtimeDir ?? '', 'cli.js'),
    );
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
