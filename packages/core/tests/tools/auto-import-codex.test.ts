import { describe, expect, it } from 'vitest';
import type { CodexAutoImportSnapshot, MemoryImportCodexResponse } from '../../src/types.js';

const BASE_SNAPSHOT: CodexAutoImportSnapshot = {
  clientDetected: false,
  debounceMs: 45000,
  lastStatus: 'idle',
  lastImported: 0,
  lastDuplicates: 0,
  lastErrors: 0,
};

describe('coordinateCodexAutoImport', () => {
  it('skips import outside Codex environment', async () => {
    let importCalls = 0;
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');

    const result = coordinateCodexAutoImport({
      now: 1_760_000_000_000,
      snapshot: BASE_SNAPSHOT,
      detectClientEnv: () => 'generic',
      runImport: () => {
        importCalls++;
        throw new Error('should not run');
      },
    });

    expect(importCalls).toBe(0);
    expect(result.ranImport).toBe(false);
    expect(result.processedInbox).toBe(false);
    expect(result.snapshot).toMatchObject({
      ...BASE_SNAPSHOT,
      clientDetected: false,
      client: 'generic',
      clientSurface: 'generic',
      detectionEvidence: ['fallback:generic'],
      lastStatus: 'skipped_not_codex',
    });
  });

  it('suppresses repeated import attempts within debounce window', async () => {
    let importCalls = 0;
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');

    const result = coordinateCodexAutoImport({
      now: 1_760_000_030_000,
      snapshot: {
        ...BASE_SNAPSHOT,
        clientDetected: true,
        lastStatus: 'imported',
        lastAttemptAt: 1_760_000_000_000,
        lastRunAt: 1_760_000_001_000,
      },
      detectClientEnv: () => 'codex',
      runImport: () => {
        importCalls++;
        throw new Error('should not run');
      },
    });

    expect(importCalls).toBe(0);
    expect(result.ranImport).toBe(false);
    expect(result.processedInbox).toBe(false);
    expect(result.snapshot).toEqual({
      ...BASE_SNAPSHOT,
      clientDetected: true,
      lastStatus: 'debounced',
      lastAttemptAt: 1_760_000_000_000,
      lastRunAt: 1_760_000_001_000,
    });
  });

  it('updates snapshot from a successful import result', async () => {
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');
    const importResult: MemoryImportCodexResponse = {
      status: 'ok',
      captureMode: 'full',
      imported: 4,
      skipped: 0,
      duplicates: 0,
      errors: 0,
      filesScanned: 1,
      latestSession: 'sess_basic_001',
      processed: 4,
      remaining: 0,
      message: 'Imported 4 Codex events into memory.',
    };

    const result = coordinateCodexAutoImport({
      now: 1_760_000_000_000,
      snapshot: BASE_SNAPSHOT,
      detectClientEnv: () => 'codex',
      runImport: () => importResult,
    });

    expect(result.ranImport).toBe(true);
    expect(result.processedInbox).toBe(true);
    expect(result.snapshot).toMatchObject({
      ...BASE_SNAPSHOT,
      clientDetected: true,
      client: 'codex',
      clientSurface: 'cli',
      detectionEvidence: ['env:CODEX_HOME'],
      debounceMs: 45000,
      lastStatus: 'imported',
      lastAttemptAt: 1_760_000_000_000,
      lastRunAt: 1_760_000_000_000,
      lastImported: 4,
      lastDuplicates: 0,
      lastErrors: 0,
      latestSession: 'sess_basic_001',
      message: 'Imported 4 Codex events into memory.',
    });
  });

  it('treats duplicates-only results as non-errors', async () => {
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');

    const result = coordinateCodexAutoImport({
      now: 1_760_000_000_000,
      snapshot: BASE_SNAPSHOT,
      detectClientEnv: () => 'codex',
      runImport: () => ({
        status: 'ok',
        captureMode: 'metadata',
        imported: 0,
        skipped: 0,
        duplicates: 3,
        errors: 0,
        filesScanned: 1,
        latestSession: 'sess_dup_001',
        processed: 0,
        remaining: 0,
        message: 'No new Codex events were imported.',
      }),
    });

    expect(result.ranImport).toBe(true);
    expect(result.processedInbox).toBe(false);
    expect(result.snapshot.lastStatus).toBe('duplicates_only');
    expect((result.snapshot as Record<string, unknown>).client).toBe('codex');
    expect((result.snapshot as Record<string, unknown>).clientSurface).toBe('cli');
    expect(result.snapshot.lastDuplicates).toBe(3);
    expect(result.snapshot.lastErrors).toBe(0);
    expect(result.snapshot.latestSession).toBe('sess_dup_001');
  });

  it('swallows thrown import errors into snapshot state', async () => {
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');

    const result = coordinateCodexAutoImport({
      now: 1_760_000_000_000,
      snapshot: BASE_SNAPSHOT,
      detectClientEnv: () => 'codex',
      runImport: () => {
        throw new Error('rollout locked');
      },
    });

    expect(result.ranImport).toBe(true);
    expect(result.processedInbox).toBe(false);
    expect(result.snapshot).toMatchObject({
      ...BASE_SNAPSHOT,
      clientDetected: true,
      client: 'codex',
      clientSurface: 'cli',
      detectionEvidence: ['env:CODEX_HOME'],
      debounceMs: 45000,
      lastStatus: 'error',
      lastAttemptAt: 1_760_000_000_000,
      lastRunAt: 1_760_000_000_000,
      lastImported: 0,
      lastDuplicates: 0,
      lastErrors: 1,
      message: 'rollout locked',
    });
  });

  it('advances debounce state even when import returns an error result', async () => {
    const { coordinateCodexAutoImport } = await import('../../src/tools/auto-import-codex.js');

    const first = coordinateCodexAutoImport({
      now: 1_760_000_000_000,
      snapshot: BASE_SNAPSHOT,
      detectClientEnv: () => 'codex',
      runImport: () => ({
        status: 'error',
        captureMode: 'full',
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: 1,
        filesScanned: 1,
        processed: 0,
        remaining: 0,
        message: 'malformed rollout',
      }),
    });

    const second = coordinateCodexAutoImport({
      now: 1_760_000_010_000,
      snapshot: first.snapshot,
      detectClientEnv: () => 'codex',
      runImport: () => {
        throw new Error('should be debounced');
      },
    });

    expect(first.snapshot.lastStatus).toBe('error');
    expect((first.snapshot as Record<string, unknown>).client).toBe('codex');
    expect((first.snapshot as Record<string, unknown>).clientSurface).toBe('cli');
    expect(first.snapshot.lastAttemptAt).toBe(1_760_000_000_000);
    expect(second.ranImport).toBe(false);
    expect(second.snapshot.lastStatus).toBe('debounced');
    expect(second.snapshot.lastAttemptAt).toBe(1_760_000_000_000);
  });
});
