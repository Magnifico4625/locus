import { describe, expect, it } from 'vitest';
import { stripNonCode } from '../../src/scanner/strip.js';

describe('stripNonCode', () => {
  // --- Basic stripping ---
  it('strips double-quoted strings', () => {
    expect(stripNonCode('const s = "hello";')).toBe('const s = "";');
  });

  it('strips single-quoted strings', () => {
    expect(stripNonCode("const s = 'hello';")).toBe('const s = "";');
  });

  it('strips line comments', () => {
    expect(stripNonCode('// comment\nexport const x = 1')).toBe('\nexport const x = 1');
  });

  it('strips block comments', () => {
    expect(stripNonCode('/* block */ export const y = 1')).toBe(' export const y = 1');
  });

  // --- Escaped quotes ---
  it('handles escaped single quotes', () => {
    expect(stripNonCode("const s = 'it\\'s fine';")).toBe('const s = "";');
  });

  it('handles escaped double quotes', () => {
    expect(stripNonCode('const s = "say \\"hello\\"";')).toBe('const s = "";');
  });

  // --- Template literals ---
  it('strips simple template literal content', () => {
    expect(stripNonCode('const x = `hello`;')).toBe('const x = ``;');
  });

  it('preserves code inside template expressions', () => {
    expect(stripNonCode('const x = `${a + b}`;')).toBe('const x = `a + b`;');
  });

  it('strips strings inside template expressions', () => {
    expect(stripNonCode('const x = `${fn("arg")}`;')).toBe('const x = `fn("")`;');
  });

  // --- Nested templates ---
  it('handles nested template literals', () => {
    expect(stripNonCode('`a${`b${c}`}d`')).toBe('``c``');
  });

  it('handles string indexing inside template', () => {
    expect(stripNonCode('`${obj["key"]}`')).toBe('`obj[""]`');
  });

  // --- Brace depth ---
  it('handles arrow functions in template expressions', () => {
    expect(stripNonCode('`${items.map(x => { return x; })}`')).toBe(
      '`items.map(x => { return x; })`',
    );
  });

  it('handles object literals in template expressions', () => {
    expect(stripNonCode('`${{ a: 1 }}`')).toBe('`{ a: 1 }`');
  });

  // --- Dynamic imports (must be preserved) ---
  it('preserves import() inside template expression', () => {
    expect(stripNonCode('`${import("./module")}`')).toBe('`import("")`');
  });

  it('preserves await import() inside template expression', () => {
    expect(stripNonCode('`${await import("./x")}`')).toBe('`await import("")`');
  });

  // --- Line preservation ---
  it('preserves line breaks in comments', () => {
    const input = 'line1\n// comment\nline3';
    const result = stripNonCode(input);
    expect(result.split('\n').length).toBe(3);
  });

  // --- Regex literals pass through (explicit non-handling) ---
  it('passes regex literals through unchanged', () => {
    expect(stripNonCode('const re = /test/g;')).toBe('const re = /test/g;');
  });

  // --- Mixed ---
  it('handles mixed content', () => {
    const input = 'export const x = `hello`; // comment';
    const result = stripNonCode(input);
    expect(result).toContain('export const x = ``');
    expect(result).not.toContain('comment');
  });

  // --- Empty / edge cases ---
  it('handles empty string', () => {
    expect(stripNonCode('')).toBe('');
  });

  it('handles code with no comments or strings', () => {
    expect(stripNonCode('const x = 1 + 2;')).toBe('const x = 1 + 2;');
  });
});
