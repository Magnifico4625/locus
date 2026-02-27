import { describe, expect, it } from 'vitest';
import {
  parseExports,
  parseImports,
  parseReExports,
} from '../../../src/scanner/parsers/typescript.js';

describe('parseExports', () => {
  it('parses named function export', () => {
    const result = parseExports('export function foo() {}');
    expect(result).toEqual([
      { name: 'foo', kind: 'function', isDefault: false, isTypeOnly: false },
    ]);
  });

  it('parses default class export', () => {
    const result = parseExports('export default class App {}');
    expect(result).toEqual([{ name: 'App', kind: 'class', isDefault: true, isTypeOnly: false }]);
  });

  it('parses const export', () => {
    const result = parseExports('export const BAR = 1');
    expect(result).toEqual([{ name: 'BAR', kind: 'const', isDefault: false, isTypeOnly: false }]);
  });

  it('parses type export', () => {
    const result = parseExports('export type User = { id: string }');
    expect(result).toEqual([{ name: 'User', kind: 'type', isDefault: false, isTypeOnly: true }]);
  });

  it('parses interface export', () => {
    const result = parseExports('export interface Config {}');
    expect(result).toEqual([
      { name: 'Config', kind: 'interface', isDefault: false, isTypeOnly: true },
    ]);
  });

  it('parses enum export', () => {
    const result = parseExports('export enum Status { Active }');
    expect(result).toEqual([{ name: 'Status', kind: 'enum', isDefault: false, isTypeOnly: false }]);
  });

  it('parses anonymous default export', () => {
    const result = parseExports('export default function() {}');
    expect(result).toEqual([
      { name: '[default]', kind: 'function', isDefault: true, isTypeOnly: false },
    ]);
  });

  it('parses multiple exports from multiline source', () => {
    const source = 'export const A = 1;\nexport function B() {}\nexport class C {}';
    const result = parseExports(source);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty for no exports', () => {
    expect(parseExports('const x = 1;')).toEqual([]);
  });
});

describe('parseImports', () => {
  it('parses named import', () => {
    const result = parseImports("import { foo } from 'bar'");
    expect(result).toEqual([{ source: 'bar', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses default import', () => {
    const result = parseImports("import React from 'react'");
    expect(result).toEqual([{ source: 'react', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses type-only import', () => {
    const result = parseImports("import type { Config } from './config'");
    expect(result).toEqual([{ source: './config', isTypeOnly: true, isDynamic: false }]);
  });

  it('parses dynamic import with literal string', () => {
    const result = parseImports("const m = await import('./utils')");
    expect(result).toEqual([{ source: './utils', isTypeOnly: false, isDynamic: true }]);
  });

  it('parses multiple imports', () => {
    const source = "import { a } from 'x';\nimport { b } from 'y';";
    expect(parseImports(source)).toHaveLength(2);
  });

  it('deduplicates same source', () => {
    const source = "import { a } from 'x';\nimport { b } from 'x';";
    expect(parseImports(source)).toHaveLength(1);
  });
});

describe('parseReExports', () => {
  it('parses named re-export', () => {
    const result = parseReExports("export { foo, bar } from './utils'");
    expect(result).toEqual([{ source: './utils', names: ['foo', 'bar'] }]);
  });

  it('parses wildcard re-export', () => {
    const result = parseReExports("export * from './types'");
    expect(result).toEqual([{ source: './types', names: '*' }]);
  });

  it('parses namespace re-export', () => {
    const result = parseReExports("export * as utils from './utils'");
    expect(result).toEqual([{ source: './utils', names: '*' }]);
  });

  it('parses type-only re-export', () => {
    const result = parseReExports("export type { User } from './models'");
    expect(result).toEqual([{ source: './models', names: ['User'] }]);
  });
});
