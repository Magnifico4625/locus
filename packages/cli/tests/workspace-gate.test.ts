import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateHookWorkspace, normalizeWorkspacePath } from '../src/workspace-gate.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'locus-ws-gate-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('evaluateHookWorkspace', () => {
  it('rejects missing workspaces, filesystem roots, home directory, agent config dirs, and system paths', () => {
    const root = makeTempDir();
    const mockHome = join(root, 'home');
    const mockTemp = join(root, 'temp');
    const locusHome = join(mockHome, '.locus');
    const pluginDir = join(mockHome, '.gemini', 'config', 'plugins', 'locus-memory');
    const codexDir = join(mockHome, '.codex');
    const dshDir = join(mockHome, '.dsh', 'profiles', 'desktop');
    const appDataDir = join(mockHome, 'AppData', 'Roaming', 'Code');
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(dshDir, { recursive: true });
    mkdirSync(locusHome, { recursive: true });
    mkdirSync(appDataDir, { recursive: true });
    mkdirSync(mockTemp, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), '{"name":"locus-plugin"}', 'utf8');
    writeFileSync(join(dshDir, 'package.json'), '{"name":"dsh-profile-desktop"}', 'utf8');

    const baseOpts = { homeDir: mockHome, tempDir: mockTemp, env: { LOCUS_HOME: locusHome } };

    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: undefined })).toEqual({
      allowed: false,
      reason: 'missing_workspace',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: '   ' })).toEqual({
      allowed: false,
      reason: 'missing_workspace',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: mockHome })).toEqual({
      allowed: false,
      reason: 'home_directory',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: pluginDir })).toEqual({
      allowed: false,
      reason: 'denied_system_path',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: codexDir })).toEqual({
      allowed: false,
      reason: 'denied_system_path',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: dshDir })).toEqual({
      allowed: false,
      reason: 'denied_system_path',
    });
    expect(evaluateHookWorkspace({ ...baseOpts, rawCwd: appDataDir })).toEqual({
      allowed: false,
      reason: 'denied_system_path',
    });
    expect(
      evaluateHookWorkspace({
        ...baseOpts,
        platform: 'win32',
        rawCwd: 'C:\\Windows\\System32',
      }),
    ).toEqual({
      allowed: false,
      reason: 'denied_system_path',
    });
    expect(normalizeWorkspacePath('C:\\Windows\\System32')).toBe('C:/Windows/System32');
    expect(normalizeWorkspacePath('/C:/Windows/System32')).toBe('C:/Windows/System32');
  });

  it('rejects temp directories by default and non-project folders without markers', () => {
    const root = makeTempDir();
    const mockHome = join(root, 'home');
    const mockTemp = join(root, 'temp');
    const tempProject = join(mockTemp, 'scratch-proj');
    const plainDir = join(mockHome, 'Documents', 'random-chat');
    const dshDefaultDir = join(mockHome, 'Documents', 'deepseek-harness-default-workspace');
    mkdirSync(tempProject, { recursive: true });
    mkdirSync(plainDir, { recursive: true });
    mkdirSync(dshDefaultDir, { recursive: true });
    writeFileSync(join(tempProject, 'package.json'), '{"name":"tmp-proj"}', 'utf8');

    const env = { LOCUS_HOME: join(mockHome, '.locus') };

    expect(
      evaluateHookWorkspace({
        rawCwd: dshDefaultDir,
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toEqual({
      allowed: false,
      reason: 'no_project_marker',
    });

    expect(
      evaluateHookWorkspace({
        rawCwd: tempProject,
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toEqual({
      allowed: false,
      reason: 'temp_directory',
    });

    expect(
      evaluateHookWorkspace({
        rawCwd: tempProject,
        homeDir: mockHome,
        tempDir: mockTemp,
        env: { ...env, LOCUS_ALLOW_TEMP_WORKSPACE: '1' },
      }),
    ).toMatchObject({
      allowed: true,
      method: 'project-marker',
    });

    expect(
      evaluateHookWorkspace({
        rawCwd: plainDir,
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toEqual({
      allowed: false,
      reason: 'no_project_marker',
    });

    writeFileSync(join(plainDir, '.locus.json'), '{}', 'utf8');
    expect(
      evaluateHookWorkspace({
        rawCwd: plainDir,
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toMatchObject({
      allowed: true,
      method: 'project-marker',
    });
  });

  it('supports config.json excludePaths, opt-in mode, and includePaths overrides', () => {
    const root = makeTempDir();
    const mockHome = join(root, 'home');
    const mockTemp = join(root, 'temp');
    const locusHome = join(mockHome, '.locus');
    const allowedRepo = join(mockHome, 'projects', 'app-a');
    const excludedRepo = join(mockHome, 'projects', 'secret-app');
    const noteFolder = join(mockHome, 'notes', 'architecture');
    mkdirSync(locusHome, { recursive: true });
    mkdirSync(join(allowedRepo, 'src'), { recursive: true });
    mkdirSync(join(excludedRepo, 'src'), { recursive: true });
    mkdirSync(noteFolder, { recursive: true });
    mkdirSync(mockTemp, { recursive: true });
    writeFileSync(join(allowedRepo, 'package.json'), '{"name":"app-a"}', 'utf8');
    writeFileSync(join(excludedRepo, 'package.json'), '{"name":"secret-app"}', 'utf8');

    writeFileSync(
      join(locusHome, 'config.json'),
      JSON.stringify({
        mode: 'opt-in',
        includePaths: [noteFolder],
        excludePaths: [excludedRepo],
      }),
      'utf8',
    );

    const env = { LOCUS_HOME: locusHome };

    expect(
      evaluateHookWorkspace({
        rawCwd: join(excludedRepo, 'src'),
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toEqual({
      allowed: false,
      reason: 'excluded_path',
    });

    expect(
      evaluateHookWorkspace({
        rawCwd: join(allowedRepo, 'src'),
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toEqual({
      allowed: false,
      reason: 'opt_in_required',
    });

    expect(
      evaluateHookWorkspace({
        rawCwd: noteFolder,
        homeDir: mockHome,
        tempDir: mockTemp,
        env,
      }),
    ).toMatchObject({
      allowed: true,
      method: 'include-list',
    });
  });
});
