import { describe, expect, it } from 'vitest';
import { HARDCODED_IGNORE, shouldIgnore } from '../../src/scanner/ignore.js';

describe('shouldIgnore', () => {
  it('ignores node_modules', () => {
    expect(shouldIgnore('node_modules/react/index.js')).toBe(true);
  });

  it('ignores .git', () => {
    expect(shouldIgnore('.git/config')).toBe(true);
  });

  it('ignores dist', () => {
    expect(shouldIgnore('dist/server.js')).toBe(true);
  });

  it('ignores .d.ts files', () => {
    expect(shouldIgnore('src/types.d.ts')).toBe(true);
  });

  it('ignores .min.js files', () => {
    expect(shouldIgnore('vendor/jquery.min.js')).toBe(true);
  });

  it('ignores .map files', () => {
    expect(shouldIgnore('dist/app.js.map')).toBe(true);
  });

  it('ignores package-lock.json', () => {
    expect(shouldIgnore('package-lock.json')).toBe(true);
  });

  it('ignores coverage directory', () => {
    expect(shouldIgnore('coverage/lcov.info')).toBe(true);
  });

  it('ignores __pycache__', () => {
    expect(shouldIgnore('__pycache__/module.pyc')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(shouldIgnore('src/auth/login.ts')).toBe(false);
    expect(shouldIgnore('tests/unit/auth.test.ts')).toBe(false);
    expect(shouldIgnore('README.md')).toBe(false);
  });

  it('HARDCODED_IGNORE has expected entries', () => {
    expect(HARDCODED_IGNORE).toContain('node_modules');
    expect(HARDCODED_IGNORE).toContain('.git');
    expect(HARDCODED_IGNORE).toContain('dist');
  });
});
