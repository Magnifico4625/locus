import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRuntimePackageSpecifier,
  findPackageRoot,
  isLatestSpecifier,
  resolvePackageVersion,
} from '../src/package-info.js';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('package info helpers', () => {
  it('resolves the root package version', () => {
    expect(resolvePackageVersion(repoRoot)).toBe('3.5.0');
  });

  it('resolves the root package version from a nested cli path', () => {
    expect(resolvePackageVersion(join(repoRoot, 'packages', 'cli', 'src'))).toBe('3.5.0');
  });

  it('resolves the root package version with the default module-relative start path', () => {
    expect(resolvePackageVersion()).toBe('3.5.0');
  });

  it('finds the locus package root by walking upward', () => {
    expect(findPackageRoot(join(repoRoot, 'packages', 'cli', 'tests'))).toBe(repoRoot);
  });

  it('builds a pinned runtime package specifier', () => {
    expect(buildRuntimePackageSpecifier('3.5.0')).toBe('locus-memory@3.5.0');
    expect(isLatestSpecifier(buildRuntimePackageSpecifier('3.5.0'))).toBe(false);
  });

  it('detects latest specifiers as unsafe for recurring runtime config', () => {
    expect(isLatestSpecifier('locus-memory@latest')).toBe(true);
    expect(isLatestSpecifier('locus-memory')).toBe(false);
  });
});
