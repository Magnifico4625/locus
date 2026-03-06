import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  projectHash,
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
} from '@locus/shared-runtime';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('resolveStorageRoot', () => {
  it('uses LOCUS_STORAGE_ROOT when set (highest priority)', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('LOCUS_STORAGE_ROOT beats CODEX_HOME', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    process.env.CODEX_HOME = '/home/user/.codex';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('LOCUS_STORAGE_ROOT beats CLAUDE_PLUGIN_ROOT', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('uses CODEX_HOME/memory when CODEX_HOME is set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveStorageRoot()).toBe(join('/home/user/.codex', 'memory'));
  });

  it('uses ~/.claude/memory when CLAUDE_PLUGIN_ROOT is set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe(join(homedir(), '.claude', 'memory'));
  });

  it('falls back to ~/.locus/memory when no env vars set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });

  it('ignores empty string env vars', () => {
    process.env.LOCUS_STORAGE_ROOT = '';
    process.env.CODEX_HOME = '';
    process.env.CLAUDE_PLUGIN_ROOT = '';
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });

  it('expands ~ in CODEX_HOME to homedir', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    process.env.CODEX_HOME = '~/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveStorageRoot()).toBe(join(homedir(), '.codex', 'memory'));
  });

  it('expands ~ in LOCUS_STORAGE_ROOT to homedir', () => {
    process.env.LOCUS_STORAGE_ROOT = '~/locus-data';
    expect(resolveStorageRoot()).toBe(join(homedir(), 'locus-data'));
  });

  it('does not expand ~ in the middle of a path', () => {
    process.env.LOCUS_STORAGE_ROOT = '/some/~/path';
    expect(resolveStorageRoot()).toBe('/some/~/path');
  });
});

describe('resolveProjectStorageDir', () => {
  it('returns storageRoot/locus-<hash>/', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const dir = resolveProjectStorageDir('/tmp/my-project');
    expect(dir).toMatch(/locus-[a-f0-9]{16}$/);
    expect(dir.startsWith(join(homedir(), '.locus', 'memory'))).toBe(true);
  });

  it('uses LOCUS_STORAGE_ROOT as base', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom';
    const dir = resolveProjectStorageDir('/tmp/my-project');
    // On Windows, join('/custom', ...) may produce '\custom\...' with backslashes
    const normalized = dir.replace(/\\/g, '/');
    expect(normalized.startsWith('/custom')).toBe(true);
    expect(dir).toContain('locus-');
  });
});

describe('resolveDbPath', () => {
  it('returns projectStorageDir/locus.db', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const dbPath = resolveDbPath('/tmp/my-project');
    expect(dbPath).toMatch(/locus-[a-f0-9]{16}[/\\]locus\.db$/);
  });
});

describe('resolveInboxDir', () => {
  it('returns projectStorageDir/inbox/', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const inboxDir = resolveInboxDir('/tmp/my-project');
    expect(inboxDir).toMatch(/locus-[a-f0-9]{16}[/\\]inbox$/);
  });
});

describe('resolveLogPath', () => {
  it('returns storageRoot/locus.log', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveLogPath()).toBe(join(homedir(), '.locus', 'memory', 'locus.log'));
  });

  it('respects LOCUS_STORAGE_ROOT', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom';
    expect(resolveLogPath()).toBe(join('/custom', 'locus.log'));
  });

  it('respects CLAUDE_PLUGIN_ROOT for backward compat', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveLogPath()).toBe(join(homedir(), '.claude', 'memory', 'locus.log'));
  });
});
