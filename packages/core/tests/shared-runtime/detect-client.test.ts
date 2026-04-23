import * as sharedRuntime from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';

describe('detectClientEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exports detectClientRuntime from the shared runtime barrel', () => {
    expect(typeof (sharedRuntime as { detectClientRuntime?: unknown }).detectClientRuntime).toBe(
      'function',
    );
  });

  it('returns "codex" when CODEX_HOME is set', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(sharedRuntime.detectClientEnv()).toBe('codex');
  });

  it('returns "claude-code" when CLAUDE_PLUGIN_ROOT is set', () => {
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(sharedRuntime.detectClientEnv()).toBe('claude-code');
  });

  it('returns "generic" when no client env vars are set', () => {
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(sharedRuntime.detectClientEnv()).toBe('generic');
  });

  it('CODEX_HOME takes priority over CLAUDE_PLUGIN_ROOT', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(sharedRuntime.detectClientEnv()).toBe('codex');
  });

  it('ignores empty string env vars', () => {
    process.env.CODEX_HOME = '';
    process.env.CLAUDE_PLUGIN_ROOT = '';
    expect(sharedRuntime.detectClientEnv()).toBe('generic');
  });

  it('returns a structured codex runtime snapshot when CODEX_HOME is set', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;

    const detectClientRuntime = (
      sharedRuntime as {
        detectClientRuntime?: () => {
          client: string;
          surface: string;
          detected: boolean;
          evidence: string[];
        };
      }
    ).detectClientRuntime;

    expect(typeof detectClientRuntime).toBe('function');
    if (!detectClientRuntime) return;

    expect(detectClientRuntime()).toEqual({
      client: 'codex',
      surface: 'cli',
      detected: true,
      evidence: ['env:CODEX_HOME'],
    });
  });

  it('returns a structured generic runtime snapshot when no client env vars are set', () => {
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;

    const detectClientRuntime = (
      sharedRuntime as {
        detectClientRuntime?: () => {
          client: string;
          surface: string;
          detected: boolean;
          evidence: string[];
        };
      }
    ).detectClientRuntime;

    expect(typeof detectClientRuntime).toBe('function');
    if (!detectClientRuntime) return;

    expect(detectClientRuntime()).toEqual({
      client: 'generic',
      surface: 'generic',
      detected: false,
      evidence: ['fallback:generic'],
    });
  });
});
