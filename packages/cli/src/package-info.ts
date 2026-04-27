import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  name?: string;
  version?: string;
}

export function findPackageRoot(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let current = resolve(startDir);

  while (true) {
    const packagePath = resolve(current, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageJson;
      if (packageJson.name === 'locus-memory') {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find locus-memory package root from ${startDir}`);
    }
    current = parent;
  }
}

export function resolvePackageVersion(startDir?: string): string {
  const root = findPackageRoot(startDir);
  const packageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ) as PackageJson;

  if (!packageJson.version) {
    throw new Error('Root package.json is missing version');
  }

  return packageJson.version;
}

export function buildRuntimePackageSpecifier(version: string): string {
  return `locus-memory@${version}`;
}

export function isLatestSpecifier(specifier: string): boolean {
  return /@latest(?:$|\s)/.test(specifier);
}
