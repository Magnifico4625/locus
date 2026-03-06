import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectHash } from './project-hash.js';
import { detectClientEnv } from './detect-client.js';

/**
 * Resolves the base storage directory for Locus databases.
 * Priority: LOCUS_STORAGE_ROOT > CODEX_HOME/memory > ~/.claude/memory > ~/.locus/memory
 * @returns {string}
 */
export function resolveStorageRoot() {
  if (process.env.LOCUS_STORAGE_ROOT) {
    return process.env.LOCUS_STORAGE_ROOT;
  }

  const client = detectClientEnv();
  const home = homedir();

  if (client === 'codex') {
    return join(process.env.CODEX_HOME, 'memory');
  }

  if (client === 'claude-code') {
    return join(home, '.claude', 'memory');
  }

  return join(home, '.locus', 'memory');
}

/**
 * Resolves the per-project storage directory.
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveProjectStorageDir(projectRoot) {
  return join(resolveStorageRoot(), `locus-${projectHash(projectRoot)}`);
}

/**
 * Resolves the SQLite database file path for a project.
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveDbPath(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), 'locus.db');
}

/**
 * Resolves the inbox directory for a project.
 * @param {string} projectRoot
 * @returns {string}
 */
export function resolveInboxDir(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), 'inbox');
}

/**
 * Resolves the log file path.
 * @returns {string}
 */
export function resolveLogPath() {
  return join(resolveStorageRoot(), 'locus.log');
}
