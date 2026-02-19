import type { Confidence, ExportEntry, ImportEntry, ReExportEntry } from '../types.js';

export interface ConfidenceInput {
  exports: ExportEntry[];
  imports: ImportEntry[];
  reExports: ReExportEntry[];
  lines: number;
  hasGeneratedHeader: boolean;
  hasDynamicImport: boolean;
  hasUnresolvedAlias: boolean;
}

export function computeConfidence(input: ConfidenceInput): Confidence {
  if (input.reExports.length > 0 && input.exports.length === 0) {
    return { level: 'medium', reason: 'barrel' };
  }
  if (input.hasDynamicImport) {
    return { level: 'medium', reason: 'dynamic-import' };
  }
  if (input.hasGeneratedHeader) {
    return { level: 'medium', reason: 'generated' };
  }
  if (input.lines > 500) {
    return { level: 'medium', reason: 'large-file' };
  }
  if (input.hasUnresolvedAlias) {
    return { level: 'medium', reason: 'alias-unresolved' };
  }
  return { level: 'high' };
}
