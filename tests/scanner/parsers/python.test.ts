import { describe, expect, it } from 'vitest';
import { parsePythonExports, parsePythonImports } from '../../../src/scanner/parsers/python.js';

describe('parsePythonExports', () => {
  it('parses class definition', () => {
    const result = parsePythonExports('class UserService:');
    expect(result).toEqual([
      { name: 'UserService', kind: 'class', isDefault: false, isTypeOnly: false },
    ]);
  });

  it('parses function definition', () => {
    const result = parsePythonExports('def process_data():');
    expect(result).toEqual([
      { name: 'process_data', kind: 'function', isDefault: false, isTypeOnly: false },
    ]);
  });

  it('skips private functions (underscore prefix)', () => {
    const result = parsePythonExports('def _internal_helper():');
    expect(result).toEqual([]);
  });

  it('skips dunder methods', () => {
    const result = parsePythonExports('def __init__(self):');
    expect(result).toEqual([]);
  });

  it('parses multiple definitions', () => {
    const source = 'class Foo:\n  pass\n\ndef bar():\n  pass\n\ndef _private():\n  pass';
    const result = parsePythonExports(source);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name)).toEqual(['Foo', 'bar']);
  });
});

describe('parsePythonImports', () => {
  it('parses from-import', () => {
    const result = parsePythonImports('from flask import Flask');
    expect(result).toEqual([{ source: 'flask', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses plain import', () => {
    const result = parsePythonImports('import os');
    expect(result).toEqual([{ source: 'os', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses relative import', () => {
    const result = parsePythonImports('from .utils import helper');
    expect(result).toEqual([{ source: '.utils', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses multiple imports', () => {
    const source = 'import os\nfrom sys import argv\nimport json';
    expect(parsePythonImports(source)).toHaveLength(3);
  });
});
