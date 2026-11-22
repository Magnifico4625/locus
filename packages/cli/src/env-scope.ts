import type { CaptureLevel } from '@locus/core';

/**
 * Runs an async callback with temporary process.env overrides and restores original env afterwards.
 */
export function withScopedEnv<T>(
  overrides: Record<string, string | undefined> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!overrides) {
    return fn();
  }

  const savedEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

export function normalizeCaptureLevel(
  raw: string | undefined,
  fallback: CaptureLevel,
): CaptureLevel {
  if (raw === 'metadata' || raw === 'redacted' || raw === 'full') {
    return raw;
  }
  return fallback;
}
