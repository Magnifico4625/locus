// Locus shared hook utilities
// Common functions used by all Claude Code hooks (PostToolUse, UserPromptSubmit, Stop).
// Plain JS — no TypeScript, no DB access, never crashes.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';

// ─── Project root resolution ────────────────────────────────────────────────

// Project markers — same list as packages/core/src/project-root.ts (Contract 7)
const PROJECT_MARKERS = [
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

/**
 * Checks whether a directory contains any project marker file.
 * Handles glob patterns like `*.sln` via readdirSync + extension matching.
 * @param {string} dir
 * @returns {boolean}
 */
function hasAnyMarker(dir) {
  for (const marker of PROJECT_MARKERS) {
    if (marker.startsWith('*')) {
      // Glob pattern like *.sln — check if any file matches the extension
      const ext = marker.slice(1); // ".sln"
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry.endsWith(ext)) return true;
        }
      } catch {
        // Directory may not be readable
      }
    } else {
      if (existsSync(join(dir, marker))) return true;
    }
  }
  return false;
}

/**
 * Computes a stable hash of the project root path.
 * @param {string} projectRoot
 * @returns {string} first 16 hex chars of SHA-256
 */
export function computeProjectHash(projectRoot) {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Resolves the project root from a working directory.
 * Algorithm: git root → walk-up project markers (highest wins) → cwd fallback.
 * Matches core project-root.ts logic to ensure consistent inbox path hashing.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveProjectRoot(cwd) {
  // 1. Git root — always wins
  try {
    const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (result) return resolve(result).replace(/\\/g, '/');
  } catch {
    // Not a git repo — fall through to marker walk-up
  }

  // 2. Walk up from cwd to filesystem root, find highest marker directory
  let highestMarkerDir = null;
  let dir = resolve(cwd);

  for (;;) {
    if (hasAnyMarker(dir)) {
      highestMarkerDir = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  if (highestMarkerDir) {
    return resolve(highestMarkerDir).replace(/\\/g, '/');
  }

  // 3. cwd fallback
  return resolve(cwd).replace(/\\/g, '/');
}

/**
 * Computes the inbox directory path for a given project root.
 * Inbox is co-located with the DB: ~/.claude/memory/locus-<hash>/inbox/
 * @param {string} projectRoot
 * @returns {string}
 */
export function computeInboxDir(projectRoot) {
  const hash = computeProjectHash(projectRoot);
  return join(homedir(), '.claude', 'memory', `locus-${hash}`, 'inbox');
}

/**
 * Computes the Locus data directory path for a given project root.
 * ~/.claude/memory/locus-<hash>/
 * @param {string} projectRoot
 * @returns {string}
 */
export function computeLocusDir(projectRoot) {
  const hash = computeProjectHash(projectRoot);
  return join(homedir(), '.claude', 'memory', `locus-${hash}`);
}

// ─── Atomic inbox writer ─────────────────────────────────────────────────────

/**
 * Atomically writes an InboxEvent JSON file to the inbox directory.
 * Uses .tmp -> rename pattern to prevent reading partial files.
 * @param {string} inboxDir
 * @param {object} inboxEvent — must have event_id and a timestamp field
 * @returns {string} final file path
 */
export function writeAtomicInboxEvent(inboxDir, inboxEvent) {
  mkdirSync(inboxDir, { recursive: true });
  const shortId = inboxEvent.event_id.slice(0, 8);
  const filename = `${inboxEvent.timestamp}-${shortId}.json`;
  const finalPath = join(inboxDir, filename);
  const tmpPath = `${finalPath}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(inboxEvent), 'utf-8');
  renameSync(tmpPath, finalPath);
  return finalPath;
}

/**
 * Generates a new UUID for event identification.
 * @returns {string}
 */
export function generateEventId() {
  return randomUUID();
}
