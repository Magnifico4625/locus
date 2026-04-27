import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PluginSyncOptions {
  sourcePath?: string;
  targetPath?: string;
  pluginRoot?: string;
}

export interface PluginSyncResult {
  sourcePath: string;
  targetPath: string;
  changed: boolean;
  pluginRoot: string;
}

export interface MarketplaceBundleOptions {
  rootDir?: string;
  version: string;
  platform?: NodeJS.Platform;
}

export interface MarketplaceBundleResult {
  marketplaceRoot: string;
  marketplacePath: string;
  pluginRoot: string;
  mcpPath: string;
  skillPath: string;
}

export function resolveCanonicalPluginSkillSourcePath(): string {
  return resolve(fileURLToPath(new URL('../skills/locus-memory/SKILL.md', import.meta.url)));
}

export function resolvePluginRootPath(): string {
  return resolve(fileURLToPath(new URL('../../../plugins/locus-memory', import.meta.url)));
}

export function resolvePluginSkillTargetPath(): string {
  return resolve(
    fileURLToPath(
      new URL('../../../plugins/locus-memory/skills/locus-memory/SKILL.md', import.meta.url),
    ),
  );
}

export function syncCodexPluginBundle(options: PluginSyncOptions = {}): PluginSyncResult {
  const sourcePath = resolve(options.sourcePath ?? resolveCanonicalPluginSkillSourcePath());
  const pluginRoot = resolve(options.pluginRoot ?? resolvePluginRootPath());
  const targetPath = resolve(options.targetPath ?? resolvePluginSkillTargetPath());

  assertRequiredPluginFile(pluginRoot, '.codex-plugin/plugin.json');
  assertRequiredPluginFile(pluginRoot, '.mcp.json');

  mkdirSync(dirname(targetPath), { recursive: true });

  const sourceContent = readFileSync(sourcePath, 'utf8');
  const changed = !existsSync(targetPath) || readFileSync(targetPath, 'utf8') !== sourceContent;
  copyFileSync(sourcePath, targetPath);

  return {
    sourcePath,
    targetPath,
    changed,
    pluginRoot,
  };
}

export function generateCodexMarketplaceBundle(
  options: MarketplaceBundleOptions,
): MarketplaceBundleResult {
  const rootDir = resolve(
    options.rootDir ?? resolve(fileURLToPath(new URL('../../..', import.meta.url))),
  );
  const marketplaceRoot = join(rootDir, 'dist', 'marketplace');
  const pluginRoot = join(marketplaceRoot, 'plugins', 'locus-memory');
  const marketplacePath = join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');
  const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
  const mcpPath = join(pluginRoot, '.mcp.json');
  const skillPath = join(pluginRoot, 'skills', 'locus-memory', 'SKILL.md');

  rmSync(marketplaceRoot, { recursive: true, force: true });
  mkdirSync(dirname(marketplacePath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(skillPath), { recursive: true });

  writeJson(marketplacePath, buildMarketplaceJson());
  writeJson(manifestPath, buildPluginManifest(options.version));
  writeJson(mcpPath, buildPublicMcpJson(options.version, options.platform));
  copyFileSync(resolveCanonicalPluginSkillSourcePath(), skillPath);

  return {
    marketplaceRoot,
    marketplacePath,
    pluginRoot,
    mcpPath,
    skillPath,
  };
}

function assertRequiredPluginFile(pluginRoot: string, relativePath: string): void {
  const fullPath = resolve(pluginRoot, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required plugin file: ${fullPath}`);
  }
}

function buildMarketplaceJson(): unknown {
  return {
    name: 'locus-codex-marketplace',
    interface: {
      displayName: 'Locus Codex Marketplace',
    },
    plugins: [
      {
        name: 'locus-memory',
        source: {
          source: 'local',
          path: './plugins/locus-memory',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: 'Productivity',
      },
    ],
  };
}

function buildPluginManifest(version: string): unknown {
  return {
    name: 'locus-memory',
    version,
    description: 'Persistent project-aware memory for Codex via Locus MCP and skill packaging.',
    author: {
      name: 'Magnifico4625',
      email: 'vozol81@mail.ru',
      url: 'https://github.com/Magnifico4625',
    },
    homepage: 'https://github.com/Magnifico4625/locus',
    repository: 'https://github.com/Magnifico4625/locus',
    license: 'MIT',
    keywords: ['codex', 'mcp', 'memory', 'productivity'],
    skills: './skills/',
    mcpServers: './.mcp.json',
    interface: {
      displayName: 'Locus Memory',
      shortDescription: 'Persistent memory and Codex recall for local projects.',
      longDescription:
        'Bundles the Locus Codex skill and MCP server configuration for one-command Codex onboarding.',
      developerName: 'Magnifico4625',
      category: 'Productivity',
      capabilities: ['Interactive', 'Write'],
      websiteURL: 'https://github.com/Magnifico4625/locus',
      privacyPolicyURL: 'https://github.com/Magnifico4625/locus',
      termsOfServiceURL: 'https://github.com/Magnifico4625/locus',
      defaultPrompt: [
        'Search memory for recent decisions in this project.',
        'Show what we decided about the current architecture.',
        'Check memory status and recent Codex imports before we continue.',
      ],
      brandColor: '#2563EB',
    },
  };
}

function buildPublicMcpJson(
  version: string,
  platform: NodeJS.Platform = process.platform,
): unknown {
  return {
    mcpServers: {
      locus: {
        command: platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['-y', `locus-memory@${version}`, 'mcp'],
        env: {
          LOCUS_LOG: 'error',
          LOCUS_CODEX_CAPTURE: 'redacted',
          LOCUS_CAPTURE_LEVEL: 'redacted',
        },
      },
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
