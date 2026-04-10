import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCodexHome, resolveCodexSessionsDir } from '../src/paths.js';
import { findCodexRolloutFiles } from '../src/session-files.js';

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-sessions-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveCodexHome', () => {
  it('uses explicit CODEX_HOME from env', () => {
    const codexHome = join(tempRoot(), 'codex-home');

    expect(resolveCodexHome({ CODEX_HOME: codexHome })).toBe(resolve(codexHome));
  });

  it('expands leading tilde in CODEX_HOME', () => {
    expect(resolveCodexHome({ CODEX_HOME: '~/.codex-alt' })).toBe(join(homedir(), '.codex-alt'));
  });

  it('falls back to ~/.codex when CODEX_HOME is missing or empty', () => {
    expect(resolveCodexHome({})).toBe(join(homedir(), '.codex'));
    expect(resolveCodexHome({ CODEX_HOME: '' })).toBe(join(homedir(), '.codex'));
  });
});

describe('resolveCodexSessionsDir', () => {
  it('uses explicit sessionsDir before CODEX_HOME', () => {
    const root = tempRoot();
    const explicitSessionsDir = join(root, 'custom-sessions');
    const codexHome = join(root, 'codex-home');

    expect(
      resolveCodexSessionsDir({
        sessionsDir: explicitSessionsDir,
        env: { CODEX_HOME: codexHome },
      }),
    ).toBe(resolve(explicitSessionsDir));
  });

  it('uses CODEX_HOME/sessions when sessionsDir is omitted', () => {
    const codexHome = join(tempRoot(), 'codex-home');

    expect(resolveCodexSessionsDir({ env: { CODEX_HOME: codexHome } })).toBe(
      join(resolve(codexHome), 'sessions'),
    );
  });

  it('falls back to ~/.codex/sessions', () => {
    expect(resolveCodexSessionsDir({ env: {} })).toBe(join(homedir(), '.codex', 'sessions'));
  });
});

describe('findCodexRolloutFiles', () => {
  it('recursively returns sorted absolute rollout JSONL files only', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const nestedDir = join(sessionsDir, '2026', '04');
    mkdirSync(nestedDir, { recursive: true });

    const rootRollout = join(sessionsDir, 'rollout-2026-04-10.jsonl');
    const nestedRollout = join(nestedDir, 'rollout-2026-04-11.jsonl');
    writeFileSync(rootRollout, '{"type":"session_meta"}\n');
    writeFileSync(nestedRollout, '{"type":"session_meta"}\n');
    writeFileSync(join(sessionsDir, 'notes.jsonl'), '{}\n');
    writeFileSync(join(nestedDir, 'rollout-2026-04-12.txt'), '{}\n');

    expect(findCodexRolloutFiles(sessionsDir)).toEqual(
      [nestedRollout, rootRollout].map((file) => resolve(file)).sort(),
    );
  });

  it('returns an empty array when sessions directory is missing', () => {
    expect(findCodexRolloutFiles(join(tempRoot(), 'missing'))).toEqual([]);
  });

  it('treats read errors as best-effort skips', () => {
    const root = tempRoot();
    const fileInsteadOfDir = join(root, 'sessions');
    writeFileSync(fileInsteadOfDir, 'not a directory');

    expect(findCodexRolloutFiles(fileInsteadOfDir)).toEqual([]);
  });
});
