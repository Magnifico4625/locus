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
  runtimeCliPath?: string;
  bundleRuntime?: boolean;
}

export interface MarketplaceBundleResult {
  marketplaceRoot: string;
  marketplacePath: string;
  pluginRoot: string;
  mcpPath: string;
  hooksPath: string;
  skillPath: string;
  runtimeDir?: string;
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
  const hooksPath = join(pluginRoot, 'hooks.json');
  const skillPath = join(pluginRoot, 'skills', 'locus-memory', 'SKILL.md');

  rmSync(marketplaceRoot, { recursive: true, force: true });
  mkdirSync(dirname(marketplacePath), { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(skillPath), { recursive: true });

  let bundledRuntimeDir: string | undefined;
  let bundledCliPath = options.runtimeCliPath;
  let bundledServerPath: string | undefined;

  if (options.bundleRuntime) {
    const distCli = join(rootDir, 'dist', 'cli.js');
    const distServer = join(rootDir, 'dist', 'server.js');
    if (!existsSync(distCli) || !existsSync(distServer)) {
      throw new Error(
        `Missing built runtime artifacts in ${join(rootDir, 'dist')} (expected cli.js and server.js).`,
      );
    }

    bundledRuntimeDir = join(pluginRoot, 'runtime');
    mkdirSync(bundledRuntimeDir, { recursive: true });
    const targetCli = join(bundledRuntimeDir, 'cli.js');
    const targetServer = join(bundledRuntimeDir, 'server.js');
    copyFileSync(distCli, targetCli);
    copyFileSync(distServer, targetServer);
    writeJson(join(bundledRuntimeDir, 'package.json'), {
      name: 'locus-local-runtime',
      private: true,
      type: 'module',
    });
    writeJson(join(bundledRuntimeDir, 'runtime.json'), {
      version: options.version,
      installedAt: new Date().toISOString(),
      cliPath: targetCli,
      serverPath: targetServer,
    });

    bundledCliPath = bundledCliPath ?? targetCli;
    bundledServerPath = targetServer;
  }

  writeJson(marketplacePath, buildMarketplaceJson());
  writeJson(manifestPath, buildPluginManifest(options.version));
  writeJson(mcpPath, buildMcpJson(options.version, options.platform, bundledServerPath));
  writeJson(hooksPath, buildHooksJson(options.version, options.platform, bundledCliPath));
  copyFileSync(resolveCanonicalPluginSkillSourcePath(), skillPath);

  return {
    marketplaceRoot,
    marketplacePath,
    pluginRoot,
    mcpPath,
    hooksPath,
    skillPath,
    ...(bundledRuntimeDir ? { runtimeDir: bundledRuntimeDir } : {}),
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
    hooks: './hooks.json',
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

function buildMcpJson(
  version: string,
  platform: NodeJS.Platform = process.platform,
  runtimeServerPath?: string,
): unknown {
  const env = {
    LOCUS_LOG: 'error',
    LOCUS_CODEX_CAPTURE: 'redacted',
    LOCUS_CAPTURE_LEVEL: 'redacted',
  };

  if (runtimeServerPath) {
    return {
      mcpServers: {
        locus: {
          command: 'node',
          args: [runtimeServerPath],
          env,
        },
      },
    };
  }

  return {
    mcpServers: {
      locus: {
        command: platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['-y', `locus-memory@${version}`, 'mcp'],
        env,
      },
    },
  };
}

function quoteShellArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildHookCommand(
  event: 'session-start' | 'user-prompt-submit' | 'post-tool-use' | 'stop',
  version: string,
  platform: NodeJS.Platform = process.platform,
  runtimeCliPath?: string,
): string {
  if (runtimeCliPath) {
    return ['node', runtimeCliPath, 'hook', 'codex', event].map(quoteShellArg).join(' ');
  }

  const npxCmd = platform === 'win32' ? 'npx.cmd' : 'npx';
  return `${npxCmd} -y locus-memory@${version} hook codex ${event}`;
}

function buildHooksJson(
  version: string,
  platform: NodeJS.Platform = process.platform,
  runtimeCliPath?: string,
): unknown {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear',
          hooks: [
            {
              type: 'command',
              command: buildHookCommand('session-start', version, platform, runtimeCliPath),
              timeout: 10,
              statusMessage: 'Preparing Locus recall freshness',
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: buildHookCommand('user-prompt-submit', version, platform, runtimeCliPath),
              timeout: 10,
              statusMessage: 'Notifying Locus about a new prompt',
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash|Write|Edit|apply_patch|shell|exec_command|run_terminal_command',
          hooks: [
            {
              type: 'command',
              command: buildHookCommand('post-tool-use', version, platform, runtimeCliPath),
              timeout: 10,
              statusMessage: 'Recording Locus tool activity',
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: buildHookCommand('stop', version, platform, runtimeCliPath),
              timeout: 10,
              statusMessage: 'Notifying Locus that the turn stopped',
            },
          ],
        },
      ],
    },
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
