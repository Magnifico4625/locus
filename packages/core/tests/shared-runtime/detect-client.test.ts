import { detectClientEnv } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';

describe('detectClientEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns "codex" when CODEX_HOME is set', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(detectClientEnv()).toBe('codex');
  });

  it('returns "claude-code" when CLAUDE_PLUGIN_ROOT is set', () => {
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(detectClientEnv()).toBe('claude-code');
  });

  it('returns "generic" when no client env vars are set', () => {
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(detectClientEnv()).toBe('generic');
  });

  it('CODEX_HOME takes priority over CLAUDE_PLUGIN_ROOT', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(detectClientEnv()).toBe('codex');
  });

  it('ignores empty string env vars', () => {
    process.env.CODEX_HOME = '';
    process.env.CLAUDE_PLUGIN_ROOT = '';
    expect(detectClientEnv()).toBe('generic');
  });
});
