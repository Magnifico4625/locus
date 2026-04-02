import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ProjectRootMethod } from './types.js';

// ─── Project Markers (Contract 7) ────────────────────────────────────────────

export const PROJECT_MARKERS: readonly string[] = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  '*.sln',
  'composer.json',
  'Gemfile',
  'deno.json',
  'bun.lockb',
];

// ─── Dependency Injection for testability ────────────────────────────────────

export interface ProjectRootDeps {
  tryGitRoot(cwd: string): string | null;
  fileExists(path: string): boolean;
  readDir(path: string): string[];
  resolveHomeDir(): string | null;
}

export const defaultProjectRootDeps: ProjectRootDeps = {
  tryGitRoot(cwd: string): string | null {
    try {
      const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return result || null;
    } catch {
      return null;
    }
  },

  fileExists(path: string): boolean {
    return existsSync(path);
  },

  readDir(path: string): string[] {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },

  resolveHomeDir(): string | null {
    try {
      return homedir();
    } catch {
      return null;
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, '/');
}

function hasAnyMarker(dir: string, markers: readonly string[], deps: ProjectRootDeps): boolean {
  for (const marker of markers) {
    if (marker.startsWith('*')) {
      // Glob pattern like *.sln — check if any file matches the extension
      const ext = marker.slice(1); // ".sln"
      const entries = deps.readDir(dir);
      for (const entry of entries) {
        if (entry.endsWith(ext)) return true;
      }
    } else {
      if (deps.fileExists(join(dir, marker))) return true;
    }
  }
  return false;
}

// ─── resolveProjectRoot (Contract 7) ─────────────────────────────────────────

export function resolveProjectRoot(
  cwd: string,
  deps: ProjectRootDeps = defaultProjectRootDeps,
): { root: string; method: ProjectRootMethod } {
  // 1. Git root — always wins
  const gitRoot = deps.tryGitRoot(cwd);
  if (gitRoot) return { root: normalizePath(gitRoot), method: 'git-root' };

  // 2. Walk up, find highest marker directory (closest to filesystem root)
  const normalizedCwd = normalizePath(cwd);
  const homeDir = deps.resolveHomeDir();
  const normalizedHomeDir = homeDir ? normalizePath(homeDir) : null;
  let highestMarkerDir: string | null = null;
  let dir = resolve(cwd);

  for (;;) {
    const normalizedDir = normalizePath(dir);
    const isAncestorHomeDir =
      normalizedHomeDir !== null &&
      normalizedDir === normalizedHomeDir &&
      normalizedDir !== normalizedCwd;

    if (!isAncestorHomeDir && hasAnyMarker(dir, PROJECT_MARKERS, deps)) {
      highestMarkerDir = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  if (highestMarkerDir) {
    return { root: normalizePath(highestMarkerDir), method: 'project-marker' };
  }

  // 3. cwd fallback
  return { root: normalizePath(cwd), method: 'cwd-fallback' };
}
