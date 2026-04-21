import { createHash } from 'node:crypto';
import { normalizePathForIdentity } from './normalize-path.js';

/**
 * Computes a stable 16-char hex hash of a project root path.
 * Normalizes through the shared identity path helper.
 * @param {string} projectRoot
 * @returns {string}
 */
export function projectHash(projectRoot) {
  const normalized = normalizePathForIdentity(projectRoot);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
