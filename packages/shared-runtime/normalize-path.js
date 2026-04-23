import { normalize } from 'node:path';

/**
 * Produces a stable path identity for hashing, dedup, and diagnostics.
 * Normalizes duplicate separators, converts backslashes to forward slashes,
 * and lowercases the result for cross-surface consistency.
 *
 * @param {string} pathValue
 * @returns {string}
 */
export function normalizePathForIdentity(pathValue) {
  return normalize(pathValue).replace(/\\/g, '/').toLowerCase();
}
