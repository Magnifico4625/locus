import { describe, expect, it } from 'vitest';
import { estimateTokens, projectHash, sanitizeFtsQuery } from '../src/utils.js';

describe('sanitizeFtsQuery', () => {
  it('wraps single word in double quotes', () => {
    expect(sanitizeFtsQuery('hello')).toBe('"hello"');
  });

  it('wraps multiple words individually', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello" "world"');
  });

  it('neutralizes dots (v3.0.1 style versions)', () => {
    expect(sanitizeFtsQuery('v3.0.1')).toBe('"v3.0.1"');
  });

  it('neutralizes hyphens (sk-abc-123 style tokens)', () => {
    expect(sanitizeFtsQuery('sk-abc-123')).toBe('"sk-abc-123"');
  });

  it('neutralizes asterisks', () => {
    expect(sanitizeFtsQuery('*.test.ts')).toBe('"*.test.ts"');
  });

  it('strips inner double quotes', () => {
    expect(sanitizeFtsQuery('"hello"')).toBe('"hello"');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeFtsQuery('   ')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFtsQuery('')).toBe('');
  });

  it('handles mixed special characters', () => {
    expect(sanitizeFtsQuery('mod.ts NEAR/2 file-path')).toBe('"mod.ts" "NEAR/2" "file-path"');
  });

  it('collapses multiple spaces between terms', () => {
    expect(sanitizeFtsQuery('hello    world')).toBe('"hello" "world"');
  });
});

describe('projectHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = projectHash('/some/project');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('normalizes backslashes to forward slashes', () => {
    const a = projectHash('C:\\Users\\test\\project');
    const b = projectHash('C:/Users/test/project');
    expect(a).toBe(b);
  });
});

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
