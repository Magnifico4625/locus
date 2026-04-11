import { describe, expect, it } from 'vitest';
import type { MemoryImportCodexResponseDisabled } from '../../src/types.js';

describe('handleImportCodex', () => {
  it('returns disabled response shape when LOCUS_CODEX_CAPTURE=off', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');

    const result = handleImportCodex(
      {},
      {
        db: undefined,
        inboxDir: '/tmp/inbox',
        captureLevel: 'metadata',
        env: { LOCUS_CODEX_CAPTURE: 'off' },
        processInbox: () => ({
          processed: 0,
          skipped: 0,
          duplicates: 0,
          filtered: 0,
          errors: 0,
          durationMs: 0,
          remaining: 0,
        }),
        importCodexSessionsToInbox: () => {
          throw new Error('importer should not be called when capture is off');
        },
      },
    );

    const expected: MemoryImportCodexResponseDisabled = {
      status: 'disabled',
      captureMode: 'off',
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0,
      filesScanned: 0,
      message: 'Codex import is disabled by LOCUS_CODEX_CAPTURE=off.',
    };

    expect(result).toEqual(expected);
  });
});
