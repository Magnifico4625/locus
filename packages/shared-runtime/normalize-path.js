import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Produces a stable path identity for hashing, dedup, and diagnostics.
 * Strips file:// URLs and Windows extended-length prefixes (\\?\ / \\?\UNC\),
 * normalizes duplicate separators, converts backslashes to forward slashes,
 * removes trailing slashes (except / and drive roots like c:/), and lowercases.
 *
 * @param {string} pathValue
 * @returns {string}
 */
export function normalizePathForIdentity(pathValue) {
  let value = pathValue.trim();

  if (/^file:\/\//i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = value.replace(/^file:\/\/(?:localhost)?/i, '');
      if (/^\/[a-zA-Z]:[\\/]/.test(value)) {
        value = value.slice(1);
      }
    }
  }

  let isUnc = false;
  if (/^(?:\\\\\?\\|\/\/\?\/)UNC[\\/]/i.test(value)) {
    value = value.replace(/^(?:\\\\\?\\|\/\/\?\/)UNC[\\/]/i, '\\\\');
    isUnc = true;
  } else if (/^(?:\\\\\?\\|\/\/\?\/)(?=[a-zA-Z]:[\\/])/u.test(value)) {
    value = value.replace(/^(?:\\\\\?\\|\/\/\?\/)/u, '');
  } else if (/^(?:\\\\|\/\/)[^?/\\]/u.test(value)) {
    isUnc = true;
  }

  let normalized = normalize(value).replace(/\\/g, '/');

  if (isUnc) {
    const withoutLeading = normalized.replace(/^\/+/u, '');
    normalized = `//${withoutLeading.replace(/\/+/gu, '/')}`;
  } else {
    normalized = normalized.replace(/\/+/gu, '/');
  }

  normalized = normalized.toLowerCase();

  if (normalized !== '/' && !/^[a-z]:\/$/u.test(normalized)) {
    normalized = normalized.replace(/\/+$/u, '');
  }

  return normalized;
}
