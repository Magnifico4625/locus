import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ProjectRootMethod, resolveProjectRoot } from '@locus/core';
import { resolveLocusHome } from '@locus/shared-runtime';

export interface LocusWorkspaceConfig {
  mode?: 'auto' | 'opt-in';
  includePaths?: string[];
  excludePaths?: string[];
}

export type WorkspaceGateDenyReason =
  | 'missing_workspace'
  | 'excluded_path'
  | 'opt_in_required'
  | 'home_directory'
  | 'temp_directory'
  | 'denied_system_path'
  | 'no_project_marker';

export type WorkspaceGateDecision =
  | {
      allowed: true;
      projectRoot: string;
      method: ProjectRootMethod | 'include-list';
    }
  | {
      allowed: false;
      reason: WorkspaceGateDenyReason;
    };

export interface EvaluateHookWorkspaceOptions {
  rawCwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  tempDir?: string;
  platform?: NodeJS.Platform;
}

const DENIED_HOME_SUBDIRS = ['.gemini', '.codex', '.locus', '.claude', '.config', '.dsh'] as const;
const DENIED_WIN_SYSTEM_PREFIXES = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
] as const;
const DENIED_POSIX_SYSTEM_PREFIXES = [
  '/usr',
  '/etc',
  '/var',
  '/bin',
  '/sbin',
  '/system',
  '/library',
] as const;

export function normalizeWorkspacePath(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  let candidate = trimmed;
  if (/^file:\/\//iu.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return undefined;
    }
  }

  if (/^\/[a-zA-Z]:(?:[\\/]|$)/u.test(candidate)) {
    candidate = candidate.slice(1);
  }

  if (/^[a-zA-Z]:(?:[\\/]|$)/u.test(candidate)) {
    const drive = candidate.slice(0, 2);
    const rest = candidate.slice(2).replace(/\\/g, '/');
    const normalizedRest = posix.normalize(rest.startsWith('/') ? rest : `/${rest}`);
    const joined = `${drive}${normalizedRest}`;
    return joined === `${drive}/` ? joined : joined.replace(/\/+$/u, '');
  }

  const normalized = resolve(candidate).replace(/\\/g, '/');
  if (normalized === '/' || /^[a-z]:\/$/iu.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/u, '');
}

function comparablePath(normalizedPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32' || /^[a-z]:\//iu.test(normalizedPath)) {
    return normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return comparablePath(left, platform) === comparablePath(right, platform);
}

function isSameOrChild(candidate: string, base: string, platform: NodeJS.Platform): boolean {
  const left = comparablePath(candidate, platform);
  const right = comparablePath(base, platform);
  if (left === right) {
    return true;
  }
  if (right === '/' || /^[a-z]:\/$/u.test(right)) {
    return left.startsWith(right);
  }
  return left.startsWith(`${right}/`);
}

function isFilesystemRoot(normalizedPath: string): boolean {
  return normalizedPath === '/' || /^[a-z]:\/$/iu.test(normalizedPath);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeWorkspacePath(entry))
    .filter((entry): entry is string => entry !== undefined);
}

export function resolveLocusWorkspaceConfigPath(
  env: Record<string, string | undefined> = process.env,
  customHomeDir?: string,
): string {
  const configuredHome = env.LOCUS_HOME?.trim();
  if (configuredHome) {
    return join(resolveLocusHome(env), 'config.json');
  }
  if (customHomeDir) {
    return join(customHomeDir, '.locus', 'config.json');
  }
  return join(resolveLocusHome(env), 'config.json');
}

export function readLocusWorkspaceConfig(
  env: Record<string, string | undefined> = process.env,
  customHomeDir?: string,
): LocusWorkspaceConfig {
  const configPath = resolveLocusWorkspaceConfigPath(env, customHomeDir);
  if (!existsSync(configPath)) {
    return { mode: 'auto', includePaths: [], excludePaths: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { mode: 'auto', includePaths: [], excludePaths: [] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      mode: record.mode === 'opt-in' ? 'opt-in' : 'auto',
      includePaths: readStringArray(record.includePaths),
      excludePaths: readStringArray(record.excludePaths),
    };
  } catch {
    return { mode: 'auto', includePaths: [], excludePaths: [] };
  }
}

function isDeniedAgentOrSystemPath(
  normalizedPath: string,
  normalizedHome: string | undefined,
  platform: NodeJS.Platform,
): WorkspaceGateDenyReason | undefined {
  if (isFilesystemRoot(normalizedPath)) {
    return 'denied_system_path';
  }

  if (normalizedHome) {
    if (isSamePath(normalizedPath, normalizedHome, platform)) {
      return 'home_directory';
    }
    for (const subdir of DENIED_HOME_SUBDIRS) {
      const denied = normalizeWorkspacePath(join(normalizedHome, subdir));
      if (denied && isSameOrChild(normalizedPath, denied, platform)) {
        return 'denied_system_path';
      }
    }
    const appData = normalizeWorkspacePath(join(normalizedHome, 'AppData'));
    if (appData && isSameOrChild(normalizedPath, appData, platform)) {
      return 'denied_system_path';
    }
  }

  for (const prefix of DENIED_WIN_SYSTEM_PREFIXES) {
    if (isSameOrChild(normalizedPath, prefix, 'win32')) {
      return 'denied_system_path';
    }
  }

  for (const prefix of DENIED_POSIX_SYSTEM_PREFIXES) {
    if (isSameOrChild(normalizedPath, prefix, platform)) {
      return 'denied_system_path';
    }
  }

  return undefined;
}

function collectTempDirs(
  options: EvaluateHookWorkspaceOptions,
  env: Record<string, string | undefined>,
  normalizedHome: string | undefined,
): string[] {
  const candidates = [
    options.tempDir ?? tmpdir(),
    env.TEMP,
    env.TMP,
    env.TMPDIR,
    normalizedHome ? join(normalizedHome, 'AppData', 'Local', 'Temp') : undefined,
  ];

  const normalizedSet = new Set<string>();
  for (const entry of candidates) {
    if (!entry) continue;
    const norm = normalizeWorkspacePath(entry);
    if (norm && !isFilesystemRoot(norm)) {
      normalizedSet.add(norm);
    }
  }
  return [...normalizedSet];
}

export function evaluateHookWorkspace(
  options: EvaluateHookWorkspaceOptions,
): WorkspaceGateDecision {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (!options.rawCwd) {
    return { allowed: false, reason: 'missing_workspace' };
  }

  const candidatePath = normalizeWorkspacePath(options.rawCwd);
  if (!candidatePath) {
    return { allowed: false, reason: 'missing_workspace' };
  }

  const rawHome = options.homeDir ?? homedir();
  const normalizedHome = normalizeWorkspacePath(rawHome);
  const config = readLocusWorkspaceConfig(env, options.homeDir);

  if (config.excludePaths?.some((excluded) => isSameOrChild(candidatePath, excluded, platform))) {
    return { allowed: false, reason: 'excluded_path' };
  }

  const explicitlyIncluded =
    config.includePaths?.some((included) => isSameOrChild(candidatePath, included, platform)) ??
    false;
  if (explicitlyIncluded) {
    const resolved = resolveProjectRoot(candidatePath);
    const resolvedNorm = normalizeWorkspacePath(resolved.root) ?? resolved.root;
    if (config.excludePaths?.some((excluded) => isSameOrChild(resolvedNorm, excluded, platform))) {
      return { allowed: false, reason: 'excluded_path' };
    }
    return {
      allowed: true,
      projectRoot: resolvedNorm,
      method: resolved.method === 'cwd-fallback' ? 'include-list' : resolved.method,
    };
  }

  if (config.mode === 'opt-in') {
    return { allowed: false, reason: 'opt_in_required' };
  }

  const tempDirs = collectTempDirs(options, env, normalizedHome);
  const insideTemp = tempDirs.some((tempPath) => isSameOrChild(candidatePath, tempPath, platform));
  const tempAllowed = env.LOCUS_ALLOW_TEMP_WORKSPACE === '1' || Boolean(env.LOCUS_STORAGE_ROOT);

  if (insideTemp) {
    if (!tempAllowed) {
      return { allowed: false, reason: 'temp_directory' };
    }
  } else {
    const deniedReason = isDeniedAgentOrSystemPath(candidatePath, normalizedHome, platform);
    if (deniedReason) {
      return { allowed: false, reason: deniedReason };
    }
  }

  const resolved = resolveProjectRoot(candidatePath);
  if (resolved.method === 'cwd-fallback') {
    return { allowed: false, reason: 'no_project_marker' };
  }

  const resolvedNorm = normalizeWorkspacePath(resolved.root) ?? resolved.root;
  if (config.excludePaths?.some((excluded) => isSameOrChild(resolvedNorm, excluded, platform))) {
    return { allowed: false, reason: 'excluded_path' };
  }

  const resolvedInsideTemp = tempDirs.some((tempPath) =>
    isSameOrChild(resolvedNorm, tempPath, platform),
  );
  if (!resolvedInsideTemp) {
    const deniedRootReason = isDeniedAgentOrSystemPath(resolvedNorm, normalizedHome, platform);
    if (deniedRootReason) {
      return { allowed: false, reason: deniedRootReason };
    }
  }

  return {
    allowed: true,
    projectRoot: resolvedNorm,
    method: resolved.method,
  };
}
