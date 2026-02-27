import type { LocusConfig } from '../types.js';
import { LOCUS_DEFAULTS } from '../types.js';

interface ConfigEntry {
  setting: string;
  value: string;
  source: string;
}

interface ConfigResult {
  entries: ConfigEntry[];
}

const ENV_MAP: Record<string, string> = {
  captureLevel: 'LOCUS_CAPTURE_LEVEL',
  logLevel: 'LOCUS_LOG',
};

export function handleConfig(
  config: LocusConfig,
  env: Record<string, string | undefined>,
  fts5Available = false,
): ConfigResult {
  const entries: ConfigEntry[] = [];

  for (const [key, value] of Object.entries(config)) {
    const envVar = ENV_MAP[key];
    const defaultValue = LOCUS_DEFAULTS[key as keyof LocusConfig];
    let source = 'default';

    if (envVar && env[envVar] !== undefined) {
      source = `env (${envVar})`;
    } else if (value !== defaultValue) {
      source = 'override';
    }

    entries.push({
      setting: key,
      value: String(value),
      source,
    });
  }

  entries.push({
    setting: 'fts5Available',
    value: String(fts5Available),
    source: 'detected',
  });

  return { entries };
}
