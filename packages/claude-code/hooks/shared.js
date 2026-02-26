// Locus shared hook utilities
// Common functions used by all Claude Code hooks (PostToolUse, UserPromptSubmit, Stop).
// Plain JS — no TypeScript, no DB access, never crashes.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, resolve } from 'node:path';

// ─── Project root resolution ────────────────────────────────────────────────

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
 * Uses `git rev-parse --show-toplevel` with a fallback to cwd.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveProjectRoot(cwd) {
  try {
    const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (result) return resolve(result).replace(/\\/g, '/');
  } catch {
    // fall through to cwd
  }
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
