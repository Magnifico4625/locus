import { describe, expect, it } from 'vitest';
import { computeConfidence } from '../../src/scanner/confidence.js';
import type { ExportEntry, ImportEntry, ReExportEntry } from '../../src/types.js';

describe('computeConfidence', () => {
  const noExports: ExportEntry[] = [];
  const noImports: ImportEntry[] = [];
  const noReExports: ReExportEntry[] = [];

  it('returns high for normal module', () => {
    const exports: ExportEntry[] = [
      { name: 'foo', kind: 'function', isDefault: false, isTypeOnly: false },
    ];
    const result = computeConfidence({
      exports,
      imports: noImports,
      reExports: noReExports,
      lines: 50,
      hasGeneratedHeader: false,
      hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'high' });
  });

  it('returns medium:barrel for barrel file', () => {
    const reExports: ReExportEntry[] = [{ source: './login', names: '*' }];
    const result = computeConfidence({
      exports: noExports,
      imports: noImports,
      reExports,
      lines: 3,
      hasGeneratedHeader: false,
      hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'barrel' });
  });

  it('returns medium:dynamic-import when present', () => {
    const result = computeConfidence({
      exports: noExports,
      imports: noImports,
      reExports: noReExports,
      lines: 50,
      hasGeneratedHeader: false,
      hasDynamicImport: true,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'dynamic-import' });
  });

  it('returns medium:generated for auto-generated files', () => {
    const result = computeConfidence({
      exports: noExports,
      imports: noImports,
      reExports: noReExports,
      lines: 50,
      hasGeneratedHeader: true,
      hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'generated' });
  });

  it('returns medium:large-file for >500 LOC', () => {
    const result = computeConfidence({
      exports: noExports,
      imports: noImports,
      reExports: noReExports,
      lines: 600,
      hasGeneratedHeader: false,
      hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'large-file' });
  });

  it('returns medium:alias-unresolved when alias failed', () => {
    const result = computeConfidence({
      exports: noExports,
      imports: noImports,
      reExports: noReExports,
      lines: 50,
      hasGeneratedHeader: false,
      hasDynamicImport: false,
      hasUnresolvedAlias: true,
    });
    expect(result).toEqual({ level: 'medium', reason: 'alias-unresolved' });
  });
});
