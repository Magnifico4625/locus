import { createHash } from 'node:crypto';
import { normalize } from 'node:path';

/**
 * Computes a stable 16-char hex hash of a project root path.
 * Normalizes: backslashes -> forward slashes, lowercased.
 * @param {string} projectRoot
 * @returns {string}
 */
export function projectHash(projectRoot) {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
