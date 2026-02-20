import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECT_MARKERS, type ProjectRootDeps, resolveProjectRoot } from '../src/project-root.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function norm(p: string): string {
  return resolve(p).replace(/\\/g, '/');
}

function gitInit(dir: string): void {
  execFileSync('git', ['init'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  writeFileSync(join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  execFileSync('git', ['commit', '-m', 'init', '--no-gpg-sign'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Mock deps that simulates a filesystem with specific markers
// Paths in markerDirs should be OS-resolved (use norm() or resolve())
function makeMockDeps(markerDirs: Record<string, string[]>): ProjectRootDeps {
  // Normalize all keys for consistent matching
  const normalizedDirs: Record<string, string[]> = {};
  for (const [dir, files] of Object.entries(markerDirs)) {
    normalizedDirs[norm(dir)] = files;
  }

  return {
    tryGitRoot(): string | null {
      return null; // no git by default
    },
    fileExists(path: string): boolean {
      const normalized = norm(path);
      for (const [dir, files] of Object.entries(normalizedDirs)) {
        for (const file of files) {
          if (normalized === `${dir}/${file}`) return true;
        }
      }
      return false;
    },
    readDir(path: string): string[] {
      const normalized = norm(path);
      return normalizedDirs[normalized] ?? [];
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveProjectRoot', () => {
  // ── Git root detection (real git) ─────────────────────────────────────

  describe('git root detection', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir('locus-root-git-');
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns git root when called from a subdirectory', () => {
      gitInit(tempDir);
      const sub = join(tempDir, 'src', 'lib');
      mkdirSync(sub, { recursive: true });

      const result = resolveProjectRoot(sub);
      expect(result.root).toBe(norm(tempDir));
      expect(result.method).toBe('git-root');
    });

    it('returns git root from the root itself', () => {
      gitInit(tempDir);

      const result = resolveProjectRoot(tempDir);
      expect(result.root).toBe(norm(tempDir));
      expect(result.method).toBe('git-root');
    });

    it('prefers git root over project markers', () => {
      gitInit(tempDir);
      writeFileSync(join(tempDir, 'package.json'), '{}');
      const sub = join(tempDir, 'src');
      mkdirSync(sub, { recursive: true });

      const result = resolveProjectRoot(sub);
      expect(result.method).toBe('git-root');
    });

    it('returns paths with forward slashes', () => {
      gitInit(tempDir);
      const result = resolveProjectRoot(tempDir);
      expect(result.root).not.toContain('\\');
    });
  });

  // ── Marker walking (mocked filesystem) ────────────────────────────────

  describe('marker walking', () => {
    let tempBase: string;

    beforeEach(() => {
      tempBase = makeTempDir('locus-root-mock-');
    });

    afterEach(() => {
      rmSync(tempBase, { recursive: true, force: true });
    });

    it('returns highest marker directory (not nearest)', () => {
      // monorepo/           <- package.json
      // monorepo/packages/web/ <- package.json
      // monorepo/packages/web/src/ <- cwd
      const monorepo = join(tempBase, 'monorepo');
      const webPkg = join(monorepo, 'packages', 'web');
      const cwd = join(webPkg, 'src');
      // Create dirs so resolve() works
      mkdirSync(cwd, { recursive: true });

      const deps = makeMockDeps({
        [monorepo]: ['package.json'],
        [webPkg]: ['package.json'],
      });

      const result = resolveProjectRoot(cwd, deps);
      expect(result.root).toBe(norm(monorepo));
      expect(result.method).toBe('project-marker');
    });

    it('finds single marker directory', () => {
      const project = join(tempBase, 'my-app');
      const cwd = join(project, 'src');
      mkdirSync(cwd, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['Cargo.toml'],
      });

      const result = resolveProjectRoot(cwd, deps);
      expect(result.root).toBe(norm(project));
      expect(result.method).toBe('project-marker');
    });

    it('detects pyproject.toml as a marker', () => {
      const project = join(tempBase, 'py-app');
      const cwd = join(project, 'src');
      mkdirSync(cwd, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['pyproject.toml'],
      });

      const result = resolveProjectRoot(cwd, deps);
      expect(result.method).toBe('project-marker');
    });

    it('detects go.mod as a marker', () => {
      const project = join(tempBase, 'go-app');
      mkdirSync(project, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['go.mod'],
      });

      const result = resolveProjectRoot(project, deps);
      expect(result.method).toBe('project-marker');
    });

    it('detects *.sln glob marker', () => {
      const project = join(tempBase, 'dotnet-app');
      const cwd = join(project, 'src');
      mkdirSync(cwd, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['MyApp.sln'],
      });

      const result = resolveProjectRoot(cwd, deps);
      expect(result.root).toBe(norm(project));
      expect(result.method).toBe('project-marker');
    });

    it('detects deno.json marker', () => {
      const project = join(tempBase, 'deno-app');
      mkdirSync(project, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['deno.json'],
      });

      const result = resolveProjectRoot(project, deps);
      expect(result.method).toBe('project-marker');
    });

    it('detects bun.lockb marker', () => {
      const project = join(tempBase, 'bun-app');
      mkdirSync(project, { recursive: true });

      const deps = makeMockDeps({
        [project]: ['bun.lockb'],
      });

      const result = resolveProjectRoot(project, deps);
      expect(result.method).toBe('project-marker');
    });
  });

  // ── CWD fallback ──────────────────────────────────────────────────────

  describe('cwd fallback', () => {
    let tempBase: string;

    beforeEach(() => {
      tempBase = makeTempDir('locus-root-fallback-');
    });

    afterEach(() => {
      rmSync(tempBase, { recursive: true, force: true });
    });

    it('falls back to cwd when no git and no markers', () => {
      const cwd = join(tempBase, 'empty');
      mkdirSync(cwd, { recursive: true });

      const deps = makeMockDeps({}); // no markers anywhere

      const result = resolveProjectRoot(cwd, deps);
      expect(result.root).toBe(norm(cwd));
      expect(result.method).toBe('cwd-fallback');
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────

  describe('PROJECT_MARKERS', () => {
    it('has 12 entries matching Contract 7', () => {
      expect(PROJECT_MARKERS).toHaveLength(12);
      expect(PROJECT_MARKERS).toContain('package.json');
      expect(PROJECT_MARKERS).toContain('pyproject.toml');
      expect(PROJECT_MARKERS).toContain('Cargo.toml');
      expect(PROJECT_MARKERS).toContain('go.mod');
      expect(PROJECT_MARKERS).toContain('pom.xml');
      expect(PROJECT_MARKERS).toContain('build.gradle');
      expect(PROJECT_MARKERS).toContain('build.gradle.kts');
      expect(PROJECT_MARKERS).toContain('*.sln');
      expect(PROJECT_MARKERS).toContain('composer.json');
      expect(PROJECT_MARKERS).toContain('Gemfile');
      expect(PROJECT_MARKERS).toContain('deno.json');
      expect(PROJECT_MARKERS).toContain('bun.lockb');
    });
  });
});
