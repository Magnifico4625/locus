import { type ScanDeps, scanProject } from '../scanner/index.js';
import type { DatabaseAdapter, LocusConfig, ScanResult } from '../types.js';

export interface ScanToolDeps {
  projectPath: string;
  db: DatabaseAdapter;
  config: LocusConfig;
  scanDeps?: ScanDeps;
}

/**
 * Thin wrapper around scanProject that exposes a consistent tool-handler interface.
 * All scanning logic lives in scanProject; this handler only wires up the deps.
 */
export async function handleScan(deps: ScanToolDeps): Promise<ScanResult> {
  return scanProject(deps.projectPath, deps.db, deps.config, deps.scanDeps);
}
