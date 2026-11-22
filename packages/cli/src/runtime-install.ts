import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeBinDir } from '@locus/shared-runtime';
import { findPackageRoot, resolvePackageVersion } from './package-info.js';

export type LocalRuntimeInstallAction = 'installed' | 'updated' | 'unchanged';

export interface InstallLocalCliRuntimeOptions {
  env?: Record<string, string | undefined>;
  sourceDistDir?: string;
  now?: Date;
  startDir?: string;
}

export interface InstallLocalCliRuntimeResult {
  action: LocalRuntimeInstallAction;
  binDir: string;
  cliPath: string;
  serverPath: string;
  manifestPath: string;
  version: string;
}

interface RuntimeManifest {
  version: string;
  installedAt: string;
  cliPath: string;
  serverPath: string;
}

function resolveDefaultSourceDistDir(startDir?: string): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(currentDir, 'cli.js')) && existsSync(join(currentDir, 'server.js'))) {
    return currentDir;
  }

  return join(findPackageRoot(startDir), 'dist');
}

export function writeFileAtomically(targetPath: string, content: Buffer | string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.locus-tmp`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, targetPath);
}

export function syncTextAtomically(targetPath: string, content: string): boolean {
  if (existsSync(targetPath)) {
    try {
      if (readFileSync(targetPath, 'utf8') === content) {
        return false;
      }
    } catch {
      // Rewrite if existing target cannot be read
    }
  }

  writeFileAtomically(targetPath, content);
  return true;
}

function syncFileAtomically(sourcePath: string, targetPath: string): boolean {
  const nextBytes = readFileSync(sourcePath);
  if (existsSync(targetPath)) {
    try {
      const currentBytes = readFileSync(targetPath);
      if (nextBytes.equals(currentBytes)) {
        return false;
      }
    } catch {
      // Rewrite if existing target cannot be read
    }
  }

  writeFileAtomically(targetPath, nextBytes);
  return true;
}

function readExistingManifest(manifestPath: string): Partial<RuntimeManifest> | undefined {
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<RuntimeManifest>;
  } catch {
    return undefined;
  }
}

export function installRuntimeFiles(
  targetDir: string,
  options: InstallLocalCliRuntimeOptions = {},
): InstallLocalCliRuntimeResult {
  const sourceDistDir = options.sourceDistDir ?? resolveDefaultSourceDistDir(options.startDir);
  const sourceCliPath = join(sourceDistDir, 'cli.js');
  const sourceServerPath = join(sourceDistDir, 'server.js');

  if (!existsSync(sourceCliPath) || !existsSync(sourceServerPath)) {
    throw new Error(
      `Missing built runtime artifacts in ${sourceDistDir} (expected cli.js and server.js). Run npm run build first.`,
    );
  }

  const cliPath = join(targetDir, 'cli.js');
  const serverPath = join(targetDir, 'server.js');
  const manifestPath = join(targetDir, 'runtime.json');
  const packageJsonPath = join(targetDir, 'package.json');
  const version = resolvePackageVersion(options.startDir);

  const hadAllTargets =
    existsSync(cliPath) &&
    existsSync(serverPath) &&
    existsSync(manifestPath) &&
    existsSync(packageJsonPath);
  const existingManifest = readExistingManifest(manifestPath);

  mkdirSync(targetDir, { recursive: true });

  const cliChanged = syncFileAtomically(sourceCliPath, cliPath);
  const serverChanged = syncFileAtomically(sourceServerPath, serverPath);
  const expectedPackageJson = `${JSON.stringify(
    { name: 'locus-local-runtime', private: true, type: 'module' },
    null,
    2,
  )}\n`;
  const packageJsonChanged = syncTextAtomically(packageJsonPath, expectedPackageJson);
  const manifestOutdated =
    !existingManifest ||
    existingManifest.version !== version ||
    existingManifest.cliPath !== cliPath ||
    existingManifest.serverPath !== serverPath;

  const manifestChanged = cliChanged || serverChanged || packageJsonChanged || manifestOutdated;
  if (manifestChanged) {
    const manifest: RuntimeManifest = {
      version,
      installedAt: (options.now ?? new Date()).toISOString(),
      cliPath,
      serverPath,
    };
    writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  let action: LocalRuntimeInstallAction = 'unchanged';
  if (!hadAllTargets) {
    action = 'installed';
  } else if (manifestChanged) {
    action = 'updated';
  }

  return {
    action,
    binDir: targetDir,
    cliPath,
    serverPath,
    manifestPath,
    version,
  };
}

export function installLocalCliRuntime(
  options: InstallLocalCliRuntimeOptions = {},
): InstallLocalCliRuntimeResult {
  return installRuntimeFiles(resolveRuntimeBinDir(options.env), options);
}
