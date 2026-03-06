import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectClientEnv,
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
  projectHash,
} from '@locus/shared-runtime';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('regression: Claude Code backward compatibility', () => {
  const setupClaudeEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/cache/locus';
  };

  it('storage root = ~/.claude/memory', () => {
    setupClaudeEnv();
    expect(resolveStorageRoot()).toBe(join(homedir(), '.claude', 'memory'));
  });

  it('DB path = ~/.claude/memory/locus-<hash>/locus.db', () => {
    setupClaudeEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveDbPath(root)).toBe(
      join(homedir(), '.claude', 'memory', `locus-${hash}`, 'locus.db'),
    );
  });

  it('inbox = ~/.claude/memory/locus-<hash>/inbox', () => {
    setupClaudeEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveInboxDir(root)).toBe(
      join(homedir(), '.claude', 'memory', `locus-${hash}`, 'inbox'),
    );
  });

  it('log = ~/.claude/memory/locus.log', () => {
    setupClaudeEnv();
    expect(resolveLogPath()).toBe(join(homedir(), '.claude', 'memory', 'locus.log'));
  });

  it('detects as claude-code client', () => {
    setupClaudeEnv();
    expect(detectClientEnv()).toBe('claude-code');
  });
});

describe('regression: Codex CLI paths', () => {
  const setupCodexEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
  };

  it('storage root = $CODEX_HOME/memory', () => {
    setupCodexEnv();
    expect(resolveStorageRoot()).toBe(join('/home/user/.codex', 'memory'));
  });

  it('DB path = $CODEX_HOME/memory/locus-<hash>/locus.db', () => {
    setupCodexEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveDbPath(root)).toBe(
      join('/home/user/.codex', 'memory', `locus-${hash}`, 'locus.db'),
    );
  });

  it('inbox = $CODEX_HOME/memory/locus-<hash>/inbox', () => {
    setupCodexEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveInboxDir(root)).toBe(
      join('/home/user/.codex', 'memory', `locus-${hash}`, 'inbox'),
    );
  });

  it('log = $CODEX_HOME/memory/locus.log', () => {
    setupCodexEnv();
    expect(resolveLogPath()).toBe(join('/home/user/.codex', 'memory', 'locus.log'));
  });

  it('detects as codex client', () => {
    setupCodexEnv();
    expect(detectClientEnv()).toBe('codex');
  });
});

describe('regression: explicit override beats everything', () => {
  it('LOCUS_STORAGE_ROOT overrides all detection', () => {
    process.env.LOCUS_STORAGE_ROOT = '/mnt/shared/locus-data';
    process.env.CODEX_HOME = '/home/user/.codex';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe('/mnt/shared/locus-data');
  });

  it('LOCUS_STORAGE_ROOT is used for DB path', () => {
    process.env.LOCUS_STORAGE_ROOT = '/mnt/shared/locus-data';
    process.env.CODEX_HOME = '/home/user/.codex';
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveDbPath(root)).toBe(
      join('/mnt/shared/locus-data', `locus-${hash}`, 'locus.db'),
    );
  });

  it('LOCUS_STORAGE_ROOT is used for log path', () => {
    process.env.LOCUS_STORAGE_ROOT = '/mnt/shared/locus-data';
    expect(resolveLogPath()).toBe(join('/mnt/shared/locus-data', 'locus.log'));
  });
});

describe('regression: generic fallback', () => {
  const setupGenericEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
  };

  it('storage root = ~/.locus/memory', () => {
    setupGenericEnv();
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });

  it('detects as generic client', () => {
    setupGenericEnv();
    expect(detectClientEnv()).toBe('generic');
  });
});

describe('regression: Windows path normalization', () => {
  it('project hash is identical for forward and backslash paths', () => {
    expect(projectHash('C:\\Users\\Admin\\my-project')).toBe(
      projectHash('C:/Users/Admin/my-project'),
    );
  });

  it('project hash is case-insensitive', () => {
    expect(projectHash('C:/Users/Admin/MyProject')).toBe(
      projectHash('c:/users/admin/myproject'),
    );
  });
});
