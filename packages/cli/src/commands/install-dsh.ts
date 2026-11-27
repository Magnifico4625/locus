import { copyFileSync, existsSync, lstatSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureLevel } from '@locus/core';
import { writeDshPluginBundle } from '../dsh/bundle.js';
import {
  DSH_DEFAULT_PROFILE,
  DSH_PLUGIN_PACKAGE_NAME,
  resolveDshCanonicalPluginDir,
  resolveDshHome,
  resolveDshProfileDir,
  resolveDshProfilePluginDir,
  validateDshProfileName,
} from '../dsh/paths.js';
import { resolvePackageVersion } from '../package-info.js';
import { installLocalCliRuntime, syncTextAtomically } from '../runtime-install.js';

export interface InstallDshDryRunOptions {
  env?: Record<string, string | undefined>;
  profile?: string;
  targetDir?: string;
  captureLevel?: CaptureLevel;
  enableMcp?: boolean;
  startDir?: string;
}

export interface InstallDshOptions extends InstallDshDryRunOptions {
  sourceDistDir?: string;
  now?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createTimestampedFileBackup(filePath: string, now: Date = new Date()): string {
  const base = `${filePath}.bak-${now.getTime()}`;
  let candidate = base;
  let counter = 0;
  while (existsSync(candidate)) {
    counter++;
    candidate = `${base}-${counter}`;
  }
  copyFileSync(filePath, candidate);
  return candidate;
}

function toFileDependencySpec(dirPath: string): string {
  return `file:${dirPath.replace(/\\/g, '/')}`;
}

function removeSymlinkIfPresent(targetPath: string): void {
  try {
    const stats = lstatSync(targetPath);
    if (!stats.isSymbolicLink()) {
      return;
    }
  } catch {
    return;
  }

  try {
    unlinkSync(targetPath);
  } catch {
    rmdirSync(targetPath);
  }
}

export function formatInstallDshDryRun(options: InstallDshDryRunOptions = {}): string {
  const env = options.env ?? process.env;
  const captureLevel = options.captureLevel ?? 'redacted';
  const enableMcp = options.enableMcp !== false;
  const version = resolvePackageVersion(options.startDir);
  const customTarget = options.targetDir?.trim();

  if (customTarget) {
    return [
      'Locus DeepSeek Harness (dsh) install dry-run (custom target)',
      `Version: ${version}`,
      `Target plugin dir: ${customTarget}`,
      `Capture level: ${captureLevel}`,
      `Auto MCP registration: ${enableMcp ? 'enabled' : 'disabled'}`,
      'Planned bundle files:',
      '  - package.json (dsh.bundle.patch -> ./cordis.patch.yml)',
      '  - cordis.patch.yml (locus-memory + @deepseek-ai/dsh-skill-filesystem)',
      '  - lib/index.js',
      '  - skills/locus-memory/SKILL.md',
      '  - runtime/server.js, runtime/cli.js, runtime/package.json, runtime/runtime.json',
      'DSH home & ~/.locus/bin: untouched (custom --target)',
    ].join('\n');
  }

  const profile = validateDshProfileName(options.profile ?? DSH_DEFAULT_PROFILE);
  const profileDir = resolveDshProfileDir(profile, env);
  const canonicalDir = resolveDshCanonicalPluginDir(env);
  const profilePluginDir = resolveDshProfilePluginDir(profile, env);

  return [
    'Locus DeepSeek Harness (dsh) install dry-run',
    `Version: ${version}`,
    `DSH home: ${resolveDshHome(env)}`,
    `Profile: ${profile} (${profileDir})`,
    `Canonical bundle dir: ${canonicalDir}`,
    `Profile node_modules copy: ${profilePluginDir}`,
    `Capture level: ${captureLevel}`,
    `Auto MCP registration: ${enableMcp ? 'enabled' : 'disabled'}`,
    'Planned manifest update:',
    `  - ${join(profileDir, 'package.json')}: add dependencies["${DSH_PLUGIN_PACKAGE_NAME}"] and dsh.profile.bundles += "${DSH_PLUGIN_PACKAGE_NAME}" (with timestamped backup)`,
    'User cordis.patch.yml: untouched',
  ].join('\n');
}

export function runInstallDsh(options: InstallDshOptions = {}): {
  exitCode: number;
  output: string;
} {
  const env = options.env ?? process.env;
  const captureLevel = options.captureLevel ?? 'redacted';
  const enableMcp = options.enableMcp !== false;
  const customTarget = options.targetDir?.trim();

  if (customTarget) {
    const bundleResult = writeDshPluginBundle({
      targetDir: customTarget,
      startDir: options.startDir,
      sourceDistDir: options.sourceDistDir,
      captureLevel,
      enableMcp,
      now: options.now,
    });

    return {
      exitCode: 0,
      output: [
        `Locus DeepSeek Harness plugin ${bundleResult.action} (${bundleResult.version})`,
        `Plugin dir: ${bundleResult.pluginDir}`,
        `Runtime dir: ${bundleResult.runtimeDir}`,
        `Capture level: ${captureLevel}`,
        `Auto MCP registration: ${enableMcp ? 'enabled' : 'disabled'}`,
        'Shared local runtime: skipped (custom --target)',
      ].join('\n'),
    };
  }

  const profile = validateDshProfileName(options.profile ?? DSH_DEFAULT_PROFILE);
  const profileDir = resolveDshProfileDir(profile, env);
  const profileManifestPath = join(profileDir, 'package.json');

  if (!existsSync(profileManifestPath)) {
    return {
      exitCode: 1,
      output: [
        `DeepSeek Harness profile "${profile}" was not found at ${profileDir}.`,
        `Missing manifest: ${profileManifestPath}.`,
        'Open DeepSeek Harness once (or initialize the profile) before running `locus-memory install dsh`.',
      ].join('\n'),
    };
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as unknown;
  } catch (error) {
    return {
      exitCode: 1,
      output: `Failed to parse ${profileManifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isPlainObject(parsedManifest)) {
    return {
      exitCode: 1,
      output: `Invalid profile manifest at ${profileManifestPath}: expected a JSON object.`,
    };
  }

  const canonicalDir = resolveDshCanonicalPluginDir(env);
  const profilePluginDir = resolveDshProfilePluginDir(profile, env);

  const canonicalResult = writeDshPluginBundle({
    targetDir: canonicalDir,
    startDir: options.startDir,
    sourceDistDir: options.sourceDistDir,
    captureLevel,
    enableMcp,
    now: options.now,
  });

  removeSymlinkIfPresent(profilePluginDir);
  const profileBundleResult = writeDshPluginBundle({
    targetDir: profilePluginDir,
    startDir: options.startDir,
    sourceDistDir: options.sourceDistDir,
    captureLevel,
    enableMcp,
    now: options.now,
  });

  const dependencies = isPlainObject(parsedManifest.dependencies)
    ? { ...parsedManifest.dependencies }
    : {};
  const dshField = isPlainObject(parsedManifest.dsh) ? { ...parsedManifest.dsh } : {};
  const profileField = isPlainObject(dshField.profile) ? { ...dshField.profile } : {};
  const existingBundles = Array.isArray(profileField.bundles)
    ? profileField.bundles.filter((item): item is string => typeof item === 'string')
    : [];

  const depSpec = toFileDependencySpec(canonicalDir);
  const nextBundles = existingBundles.includes(DSH_PLUGIN_PACKAGE_NAME)
    ? existingBundles
    : [...existingBundles, DSH_PLUGIN_PACKAGE_NAME];
  const needsManifestUpdate =
    dependencies[DSH_PLUGIN_PACKAGE_NAME] !== depSpec ||
    nextBundles.length !== existingBundles.length;

  let backupPath: string | undefined;
  let manifestAction: 'updated' | 'unchanged' = 'unchanged';
  if (needsManifestUpdate) {
    backupPath = createTimestampedFileBackup(profileManifestPath, options.now);
    const nextManifest: Record<string, unknown> = {
      ...parsedManifest,
      dependencies: {
        ...dependencies,
        [DSH_PLUGIN_PACKAGE_NAME]: depSpec,
      },
      dsh: {
        ...dshField,
        profile: {
          ...profileField,
          bundles: nextBundles,
        },
      },
    };
    syncTextAtomically(profileManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    manifestAction = 'updated';
  }

  const localRuntimeResult = installLocalCliRuntime({
    env,
    startDir: options.startDir,
    sourceDistDir: options.sourceDistDir,
    now: options.now,
  });

  const lines = [
    `Locus DeepSeek Harness plugin ${profileBundleResult.action} (${profileBundleResult.version})`,
    `Profile: ${profile} (${profileDir})`,
    `Canonical bundle (${canonicalResult.action}): ${canonicalResult.pluginDir}`,
    `Profile bundle copy (${profileBundleResult.action}): ${profileBundleResult.pluginDir}`,
    `Profile manifest (${manifestAction}): ${profileManifestPath}`,
    ...(backupPath ? [`Backup: ${backupPath}`] : []),
    `Capture level: ${captureLevel}`,
    `Auto MCP registration: ${enableMcp ? 'enabled' : 'disabled'}`,
    `Shared local runtime (${localRuntimeResult.action}): ${localRuntimeResult.binDir}`,
    'User cordis.patch.yml: untouched',
    'Restart DeepSeek Harness if it is already running to load the updated Cordis plugin.',
  ];

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
