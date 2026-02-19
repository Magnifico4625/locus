import { describe, expect, it } from 'vitest';
import { parsePackageJson, parseTsConfig } from '../../../src/scanner/parsers/config.js';

describe('parsePackageJson', () => {
  it('extracts dependencies as stack', () => {
    const result = parsePackageJson(
      JSON.stringify({
        dependencies: { express: '^4.0.0', prisma: '^5.0.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );
    expect(result.stack).toContain('express');
    expect(result.stack).toContain('prisma');
  });

  it('extracts script names', () => {
    const result = parsePackageJson(
      JSON.stringify({
        scripts: { build: 'tsc', test: 'vitest', dev: 'nodemon' },
      }),
    );
    expect(result.scripts).toEqual(['build', 'test', 'dev']);
  });

  it('extracts dependency names', () => {
    const result = parsePackageJson(
      JSON.stringify({
        dependencies: { react: '18.0.0' },
        devDependencies: { typescript: '5.0.0' },
      }),
    );
    expect(result.dependencies).toContain('react');
    expect(result.dependencies).toContain('typescript');
  });

  it('handles missing fields gracefully', () => {
    const result = parsePackageJson('{}');
    expect(result.stack).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });

  it('handles invalid JSON', () => {
    const result = parsePackageJson('not json');
    expect(result.stack).toEqual([]);
  });
});

describe('parseTsConfig', () => {
  it('extracts path aliases', () => {
    const result = parseTsConfig(
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'], '@utils/*': ['./src/utils/*'] },
        },
      }),
    );
    expect(result).toEqual({
      '@/*': './src/*',
      '@utils/*': './src/utils/*',
    });
  });

  it('returns empty for no paths', () => {
    const result = parseTsConfig(JSON.stringify({ compilerOptions: {} }));
    expect(result).toEqual({});
  });

  it('handles invalid JSON', () => {
    const result = parseTsConfig('not json');
    expect(result).toEqual({});
  });
});
