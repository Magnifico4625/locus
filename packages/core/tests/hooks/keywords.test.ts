import { describe, expect, it } from 'vitest';

describe('extractKeywords (RAKE)', () => {
  it('extracts meaningful keywords from a normal sentence', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords('Fix the authentication bug in login flow');
    // 'the' and 'in' are stopwords → phrases: ['fix'], ['authentication', 'bug'], ['login', 'flow']
    expect(result).toContain('authentication bug');
    expect(result).toContain('login flow');
    expect(result).not.toContain(' the ');
    expect(result).not.toContain(' in ');
  });

  it('returns empty string for empty input', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    expect(extractKeywords('')).toBe('');
    expect(extractKeywords('   ')).toBe('');
  });

  it('returns empty string for non-string input', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(extractKeywords(null as any)).toBe('');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(extractKeywords(undefined as any)).toBe('');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(extractKeywords(42 as any)).toBe('');
  });

  it('returns text as-is when 3 words or fewer', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    expect(extractKeywords('fix bug')).toBe('fix bug');
    expect(extractKeywords('hello world!')).toBe('hello world!');
    expect(extractKeywords('one two three')).toBe('one two three');
  });

  it('filters programming stopwords', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords(
      'export const function return async await authentication handler',
    );
    // 'export', 'const', 'function', 'return', 'async', 'await' are programming stopwords
    expect(result).toContain('authentication');
    expect(result).toContain('handler');
    expect(result).not.toMatch(/\bconst\b/);
    expect(result).not.toMatch(/\bfunction\b/);
  });

  it('respects maxKeywords parameter', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const longText =
      'authentication handler, database migration, caching strategy, error boundary, ' +
      'deployment pipeline, monitoring dashboard, security audit, performance benchmark, ' +
      'API gateway, microservice orchestration and the other things to consider';
    const result = extractKeywords(longText, 3);
    const phrases = result.split(', ');
    expect(phrases.length).toBeLessThanOrEqual(3);
  });

  it('handles Cyrillic text', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords('Исправь баг аутентификации в модуле входа пользователя');
    // Cyrillic words should be extracted (none are in English stopwords except 'в' if matching)
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('аутентификации');
  });

  it('handles mixed text with code references', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords('Refactor the database layer in auth-service module');
    expect(result).toContain('database layer');
    expect(result).toContain('auth-service module');
  });

  it('deduplicates identical phrases', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords(
      'database error and database error and database error and something else',
    );
    // Comma-separated phrases should not have exact duplicates
    const phrases = result.split(', ');
    const unique = new Set(phrases);
    expect(phrases.length).toBe(unique.size);
  });

  it('returns empty string when all words are stopwords', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords('the and or but in on at to for of with by');
    expect(result).toBe('');
  });

  it('ranks multi-word phrases higher than single words', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    // 'fix' and 'add' are stopwords; 'refactor' is not
    const result = extractKeywords('refactor the authentication handler for the login service');
    const phrases = result.split(', ');
    // RAKE scores: 'authentication handler' (degree 2+2=4) > 'login service' (4) > 'refactor' (1)
    // Multi-word phrases should rank before single-word
    expect(phrases[0]).toContain(' ');
  });

  it('handles single meaningful word in a sentence', async () => {
    const { extractKeywords } = await import('../../../claude-code/hooks/keywords.js');
    const result = extractKeywords('please do the authentication for me now');
    // Most are stopwords; only 'authentication' remains
    expect(result).toContain('authentication');
  });
});
