import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DSH_DEFAULT_PROFILE,
  DSH_PLUGIN_PACKAGE_NAME,
  resolveDshCanonicalPluginDir,
  resolveDshProfileDir,
  resolveDshProfilePluginDir,
  validateDshProfileName,
} from '../dsh/paths.js';
import { syncTextAtomically } from '../runtime-install.js';
import { createTimestampedFileBackup } from './install-dsh.js';

export interface UninstallDshOptions {
  env?: Record<string, string | undefined>;
  profile?: string;
  targetDir?: string;
  now?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeVerifiedPluginDir(pluginDir: string): {
  status: 'removed' | 'absent' | 'error';
  message?: string;
} {
  if (!existsSync(pluginDir)) {
    return { status: 'absent' };
  }

  const manifestPath = join(pluginDir, 'package.json');
  if (!existsSync(manifestPath)) {
    return {
      status: 'error',
      message: `Refusing to remove ${pluginDir}: missing package.json.`,
    };
  }

  let pkgName: unknown;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    pkgName = parsed.name;
  } catch {
    return {
      status: 'error',
      message: `Refusing to remove ${pluginDir}: unreadable package.json.`,
    };
  }

  if (pkgName !== DSH_PLUGIN_PACKAGE_NAME) {
    return {
      status: 'error',
      message: `Refusing to remove foreign plugin at ${pluginDir} (package.json name is "${String(pkgName)}").`,
    };
  }

  rmSync(pluginDir, { recursive: true, force: true });
  return { status: 'removed' };
}

export function runUninstallDsh(options: UninstallDshOptions = {}): {
  exitCode: number;
  output: string;
} {
  const env = options.env ?? process.env;
  const customTarget = options.targetDir?.trim();

  if (customTarget) {
    const removal = removeVerifiedPluginDir(customTarget);
    if (removal.status === 'error') {
      return { exitCode: 1, output: removal.message ?? 'Refused to remove target.' };
    }
    if (removal.status === 'absent') {
      return {
        exitCode: 0,
        output: [
          `Locus DeepSeek Harness plugin is not installed at ${customTarget}.`,
          'Memory data untouched.',
        ].join('\n'),
      };
    }
    return {
      exitCode: 0,
      output: [
        `Locus DeepSeek Harness plugin removed: ${customTarget}`,
        'Memory data untouched.',
      ].join('\n'),
    };
  }

  const profile = validateDshProfileName(options.profile ?? DSH_DEFAULT_PROFILE);
  const profileDir = resolveDshProfileDir(profile, env);
  const profileManifestPath = join(profileDir, 'package.json');
  const profilePluginDir = resolveDshProfilePluginDir(profile, env);
  const canonicalDir = resolveDshCanonicalPluginDir(env);

  const profileRemoval = removeVerifiedPluginDir(profilePluginDir);
  if (profileRemoval.status === 'error') {
    return { exitCode: 1, output: profileRemoval.message ?? 'Refused to remove profile bundle.' };
  }

  const canonicalRemoval = removeVerifiedPluginDir(canonicalDir);
  if (canonicalRemoval.status === 'error') {
    return {
      exitCode: 1,
      output: canonicalRemoval.message ?? 'Refused to remove canonical bundle.',
    };
  }

  let backupPath: string | undefined;
  let manifestUpdated = false;
  if (existsSync(profileManifestPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as unknown;
    } catch (error) {
      return {
        exitCode: 1,
        output: `Failed to parse ${profileManifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (isPlainObject(parsed)) {
      const deps = isPlainObject(parsed.dependencies) ? { ...parsed.dependencies } : undefined;
      const hadDep = deps !== undefined && DSH_PLUGIN_PACKAGE_NAME in deps;
      if (hadDep && deps) {
        delete deps[DSH_PLUGIN_PACKAGE_NAME];
      }

      const dshField = isPlainObject(parsed.dsh) ? { ...parsed.dsh } : undefined;
      const profileField =
        dshField && isPlainObject(dshField.profile) ? { ...dshField.profile } : undefined;
      const existingBundles = Array.isArray(profileField?.bundles)
        ? profileField.bundles.filter((item): item is string => typeof item === 'string')
        : undefined;
      const filteredBundles = existingBundles?.filter((item) => item !== DSH_PLUGIN_PACKAGE_NAME);
      const hadBundle =
        existingBundles !== undefined &&
        filteredBundles !== undefined &&
        filteredBundles.length !== existingBundles.length;

      if (hadDep || hadBundle) {
        backupPath = createTimestampedFileBackup(profileManifestPath, options.now);
        const nextManifest: Record<string, unknown> = { ...parsed };
        if (deps !== undefined) {
          nextManifest.dependencies = deps;
        }
        if (dshField !== undefined && profileField !== undefined && filteredBundles !== undefined) {
          nextManifest.dsh = {
            ...dshField,
            profile: {
              ...profileField,
              bundles: filteredBundles,
            },
          };
        }
        syncTextAtomically(profileManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
        manifestUpdated = true;
      }
    }
  }

  const lines = [
    `Locus DeepSeek Harness uninstall completed for profile "${profile}" (${profileDir}).`,
    `Profile bundle: ${profileRemoval.status} (${profilePluginDir})`,
    `Canonical bundle: ${canonicalRemoval.status} (${canonicalDir})`,
    `Profile manifest: ${manifestUpdated ? 'updated' : 'unchanged'}`,
    ...(backupPath ? [`Backup: ${backupPath}`] : []),
    'User cordis.patch.yml: untouched',
    'Memory data untouched.',
  ];

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}
