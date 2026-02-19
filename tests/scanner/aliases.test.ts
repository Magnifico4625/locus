import { describe, expect, it } from 'vitest';
import type { PathAliasMap } from '../../src/scanner/aliases.js';
import { loadPathAliases, resolveAlias } from '../../src/scanner/aliases.js';

describe('loadPathAliases', () => {
  it('loads aliases from tsconfig paths', () => {
    const aliases = loadPathAliases({
      '@/*': './src/*',
      '@utils/*': './src/utils/*',
    });
    expect(aliases['@/*']).toBe('./src/*');
  });

  it('returns empty for empty input', () => {
    expect(loadPathAliases({})).toEqual({});
  });
});

describe('resolveAlias', () => {
  const aliases: PathAliasMap = {
    '@/*': './src/*',
    '@utils/*': './src/utils/*',
  };

  it('resolves @ alias to src path', () => {
    expect(resolveAlias('@/auth/login', aliases)).toBe('src/auth/login');
  });

  it('resolves @utils alias', () => {
    expect(resolveAlias('@utils/helpers', aliases)).toBe('src/utils/helpers');
  });

  it('returns undefined for non-alias path', () => {
    expect(resolveAlias('./local-file', aliases)).toBeUndefined();
  });

  it('returns undefined for npm package', () => {
    expect(resolveAlias('react', aliases)).toBeUndefined();
  });

  it('picks longest matching prefix', () => {
    expect(resolveAlias('@utils/deep/file', aliases)).toBe('src/utils/deep/file');
  });
});
