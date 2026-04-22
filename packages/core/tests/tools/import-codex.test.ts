import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DatabaseAdapter,
  IngestMetrics,
  MemoryImportCodexResponseDisabled,
} from '../../src/types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-import-codex-test-'));
  tempDirs.push(dir);
  return dir;
}

function makeIngestMetrics(overrides: Partial<IngestMetrics> = {}): IngestMetrics {
  return {
    processed: 0,
    skipped: 0,
    duplicates: 0,
    filtered: 0,
    errors: 0,
    durationMs: 0,
    remaining: 0,
    ...overrides,
  };
}

function makeDbWithIngestedIds(ingestedEventIds: Set<string>): DatabaseAdapter {
  return {
    exec: () => {},
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    get: () => undefined,
    all: () => Array.from(ingestedEventIds, (event_id) => ({ event_id })),
    close: () => {},
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('handleImportCodex', () => {
  it('returns disabled response shape when LOCUS_CODEX_CAPTURE=off', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');

    const result = handleImportCodex(
      {},
      {
        db: undefined,
        inboxDir: '/tmp/inbox',
        captureLevel: 'metadata',
        fts5Available: false,
        env: { LOCUS_CODEX_CAPTURE: 'off' },
        processInbox: () => makeIngestMetrics(),
        runDurableExtraction: () => ({
          scanned: 0,
          inserted: 0,
          confirmed: 0,
          superseded: 0,
          ignored: 0,
          watermarkEventId: 0,
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

  it('maps importer parseErrors into final errors', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');

    const result = handleImportCodex(
      {},
      {
        db: makeDbWithIngestedIds(new Set()),
        inboxDir: createTempDir(),
        captureLevel: 'metadata',
        fts5Available: false,
        env: {},
        processInbox: () => {
          throw new Error('processInbox should not run when importer wrote nothing');
        },
        runDurableExtraction: () => ({
          scanned: 0,
          inserted: 0,
          confirmed: 0,
          superseded: 0,
          ignored: 0,
          watermarkEventId: 0,
        }),
        importCodexSessionsToInbox: () => ({
          filesScanned: 2,
          recordsParsed: 5,
          parseErrors: 2,
          normalized: 3,
          written: 0,
          duplicatePending: 0,
          skippedUnknown: 1,
          skippedByCapture: 0,
          skippedByFilter: 0,
          errors: 1,
          latestSession: 'sess_parse_001',
        }),
      },
    );

    expect(result.status).toBe('ok');
    expect(result.errors).toBe(3);
    expect(result.filesScanned).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('passes shouldSkipEventId backed by ingest_log event ids and surfaces duplicates', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');
    const ingested = new Set(['known-event-id']);
    let callbackMatched = false;

    const result = handleImportCodex(
      {},
      {
        db: makeDbWithIngestedIds(ingested),
        inboxDir: createTempDir(),
        captureLevel: 'metadata',
        fts5Available: false,
        env: {},
        processInbox: () => {
          throw new Error('processInbox should not run when importer wrote nothing');
        },
        runDurableExtraction: () => ({
          scanned: 0,
          inserted: 0,
          confirmed: 0,
          superseded: 0,
          ignored: 0,
          watermarkEventId: 0,
        }),
        importCodexSessionsToInbox: (options) => {
          callbackMatched = options.shouldSkipEventId?.('known-event-id') === true;
          return {
            filesScanned: 1,
            recordsParsed: 4,
            parseErrors: 0,
            normalized: 4,
            written: 0,
            duplicatePending: callbackMatched ? 1 : 0,
            skippedUnknown: 0,
            skippedByCapture: 0,
            skippedByFilter: 0,
            errors: 0,
            latestSession: 'sess_dup_001',
          };
        },
      },
    );

    expect(callbackMatched).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.duplicates).toBe(1);
    expect(result.imported).toBe(0);
  });

  it('does not call processInbox when importer produces no new writes', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');
    let processCalls = 0;
    let durableCalls = 0;

    const result = handleImportCodex(
      {},
      {
        db: makeDbWithIngestedIds(new Set()),
        inboxDir: createTempDir(),
        captureLevel: 'metadata',
        fts5Available: false,
        env: {},
        processInbox: () => {
          processCalls++;
          return makeIngestMetrics();
        },
        runDurableExtraction: () => {
          durableCalls++;
          return {
            scanned: 0,
            inserted: 0,
            confirmed: 0,
            superseded: 0,
            ignored: 0,
            watermarkEventId: 0,
          };
        },
        importCodexSessionsToInbox: () => ({
          filesScanned: 1,
          recordsParsed: 0,
          parseErrors: 0,
          normalized: 0,
          written: 0,
          duplicatePending: 0,
          skippedUnknown: 0,
          skippedByCapture: 0,
          skippedByFilter: 0,
          errors: 0,
          latestSession: undefined,
        }),
      },
    );

    expect(processCalls).toBe(0);
    expect(durableCalls).toBe(0);
    expect(result.status).toBe('ok');
    expect(result.imported).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('reports imported only for current-run events that reach ingest_log after processing', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');
    const inboxDir = createTempDir();
    const ingested = new Set<string>();

    writeFileSync(
      join(inboxDir, 'preexisting.json'),
      JSON.stringify({ event_id: 'old-pending' }),
      'utf-8',
    );

    const result = handleImportCodex(
      {},
      {
        db: makeDbWithIngestedIds(ingested),
        inboxDir,
        captureLevel: 'metadata',
        fts5Available: false,
        env: {},
        processInbox: () => {
          ingested.add('run-event-1');
          ingested.add('old-pending');
          return makeIngestMetrics({ processed: 5, remaining: 0 });
        },
        runDurableExtraction: () => ({
          scanned: 2,
          inserted: 1,
          confirmed: 0,
          superseded: 0,
          ignored: 1,
          watermarkEventId: 10,
        }),
        importCodexSessionsToInbox: () => {
          writeFileSync(
            join(inboxDir, 'run-1.json'),
            JSON.stringify({ event_id: 'run-event-1' }),
            'utf-8',
          );
          writeFileSync(
            join(inboxDir, 'run-2.json'),
            JSON.stringify({ event_id: 'run-event-2' }),
            'utf-8',
          );
          return {
            filesScanned: 1,
            recordsParsed: 2,
            parseErrors: 0,
            normalized: 2,
            written: 2,
            duplicatePending: 0,
            skippedUnknown: 0,
            skippedByCapture: 0,
            skippedByFilter: 0,
            errors: 0,
            latestSession: 'sess_import_001',
          };
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.imported).toBe(1);
    expect(result.processed).toBe(5);
    expect(result.duplicates).toBe(0);
  });

  it('runs durable extraction after processInbox when importer writes new events', async () => {
    const { handleImportCodex } = await import('../../src/tools/import-codex.js');
    const inboxDir = createTempDir();
    const ingested = new Set<string>();
    let durableCalls = 0;

    const result = handleImportCodex(
      {},
      {
        db: makeDbWithIngestedIds(ingested),
        inboxDir,
        captureLevel: 'metadata',
        fts5Available: false,
        env: {},
        processInbox: () => {
          ingested.add('run-event-1');
          return makeIngestMetrics({ processed: 1, remaining: 0 });
        },
        runDurableExtraction: () => {
          durableCalls++;
          return {
            scanned: 1,
            inserted: 1,
            confirmed: 0,
            superseded: 0,
            ignored: 0,
            watermarkEventId: 1,
          };
        },
        importCodexSessionsToInbox: () => {
          writeFileSync(
            join(inboxDir, 'run-1.json'),
            JSON.stringify({ event_id: 'run-event-1' }),
            'utf-8',
          );
          return {
            filesScanned: 1,
            recordsParsed: 1,
            parseErrors: 0,
            normalized: 1,
            written: 1,
            duplicatePending: 0,
            skippedUnknown: 0,
            skippedByCapture: 0,
            skippedByFilter: 0,
            errors: 0,
            latestSession: 'sess_durable_001',
          };
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.imported).toBe(1);
    expect(durableCalls).toBe(1);
  });
});
