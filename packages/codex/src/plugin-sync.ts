import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

export function resolveCanonicalPluginSkillSourcePath(): string {
  return resolve(fileURLToPath(new URL('../skills/locus-memory/SKILL.md', import.meta.url)));
}

export function resolvePluginRootPath(): string {
  return resolve(fileURLToPath(new URL('../../../plugins/locus-memory', import.meta.url)));
}

export function resolvePluginSkillTargetPath(): string {
  return resolve(fileURLToPath(new URL('../../../plugins/locus-memory/skills/locus-memory/SKILL.md', import.meta.url)));
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

function assertRequiredPluginFile(pluginRoot: string, relativePath: string): void {
  const fullPath = resolve(pluginRoot, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required plugin file: ${fullPath}`);
  }
}
