import { describe, expect, it } from 'vitest';
import { handleConfig } from '../../src/tools/config.js';
import type { LocusConfig } from '../../src/types.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

describe('handleConfig', () => {
  const defaultConfig: LocusConfig = { ...LOCUS_DEFAULTS };

  it('returns all config entries', () => {
    const result = handleConfig(defaultConfig, {});
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('each entry has setting, value, and source fields', () => {
    const result = handleConfig(defaultConfig, {});
    for (const entry of result.entries) {
      expect(entry).toHaveProperty('setting');
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('source');
    }
  });

  it('reports default source when no env var is set', () => {
    const result = handleConfig(defaultConfig, {});
    const captureEntry = result.entries.find((e) => e.setting === 'captureLevel');
    expect(captureEntry?.value).toBe('metadata');
    expect(captureEntry?.source).toBe('default');
  });

  it('reports env source when env var overrides config', () => {
    const overriddenConfig: LocusConfig = { ...LOCUS_DEFAULTS, captureLevel: 'redacted' };
    const env = { LOCUS_CAPTURE_LEVEL: 'redacted' };
    const result = handleConfig(overriddenConfig, env);
    const captureEntry = result.entries.find((e) => e.setting === 'captureLevel');
    expect(captureEntry?.value).toBe('redacted');
    expect(captureEntry?.source).toBe('env (LOCUS_CAPTURE_LEVEL)');
  });

  it('reports env source for LOCUS_LOG', () => {
    const overriddenConfig: LocusConfig = { ...LOCUS_DEFAULTS, logLevel: 'debug' };
    const env = { LOCUS_LOG: 'debug' };
    const result = handleConfig(overriddenConfig, env);
    const logEntry = result.entries.find((e) => e.setting === 'logLevel');
    expect(logEntry?.source).toBe('env (LOCUS_LOG)');
  });

  it('includes fts5Available as detected source', () => {
    const result = handleConfig(defaultConfig, {}, true);
    const ftsEntry = result.entries.find((e) => e.setting === 'fts5Available');
    expect(ftsEntry?.value).toBe('true');
    expect(ftsEntry?.source).toBe('detected');
  });

  it('reports fts5Available false when not available', () => {
    const result = handleConfig(defaultConfig, {}, false);
    const ftsEntry = result.entries.find((e) => e.setting === 'fts5Available');
    expect(ftsEntry?.value).toBe('false');
    expect(ftsEntry?.source).toBe('detected');
  });

  it('includes all LocusConfig keys plus fts5Available', () => {
    const result = handleConfig(defaultConfig, {});
    const configKeys = Object.keys(LOCUS_DEFAULTS);
    for (const key of configKeys) {
      expect(result.entries.find((e) => e.setting === key)).toBeDefined();
    }
    expect(result.entries.find((e) => e.setting === 'fts5Available')).toBeDefined();
  });
});
