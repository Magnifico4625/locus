import type { LocusConfig, ScanResult, ScanStrategy } from '../types.js';

export function chooseScanStrategy(
  _projectPath: string,
  _lastScan: number,
  _lastHead: string | null,
  _config: LocusConfig,
): ScanStrategy {
  // TODO: implement scan strategy selection (Contract 6)
  return { type: 'full', filesToScan: [], reason: 'not implemented' };
}

export async function scanProject(_projectPath: string, _config: LocusConfig): Promise<ScanResult> {
  // TODO: implement project scanning
  throw new Error('Not implemented');
}
