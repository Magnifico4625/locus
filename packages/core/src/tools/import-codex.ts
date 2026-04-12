import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CaptureLevel,
  CodexImportCaptureMode,
  DatabaseAdapter,
  IngestMetrics,
  MemoryImportCodexResponse,
} from '../types.js';

interface CodexImportToolParams {
  latestOnly?: boolean;
  projectRoot?: string;
  sessionId?: string;
  since?: number;
}

interface CodexImporterMetricsLike {
  filesScanned: number;
  recordsParsed: number;
  parseErrors: number;
  normalized: number;
  written: number;
  duplicatePending: number;
  skippedUnknown: number;
  skippedByCapture: number;
  skippedByFilter: number;
  errors: number;
  latestSession?: string;
}

interface CodexImporterOptionsLike extends CodexImportToolParams {
  inboxDir: string;
  captureMode: CodexImportCaptureMode;
  env?: Record<string, string | undefined>;
  shouldSkipEventId?: (eventId: string) => boolean;
}

interface ProcessInboxOptionsLike {
  batchLimit?: number;
  captureLevel?: CaptureLevel;
  fts5Available?: boolean;
}

export interface ImportCodexDeps {
  db?: DatabaseAdapter;
  inboxDir: string;
  captureLevel: CaptureLevel;
  fts5Available: boolean;
  env?: Record<string, string | undefined>;
  processInbox: (
    inboxDir: string,
    db: DatabaseAdapter,
    options?: ProcessInboxOptionsLike,
  ) => IngestMetrics;
  importCodexSessionsToInbox: (options: CodexImporterOptionsLike) => CodexImporterMetricsLike;
}

interface EventIdRow {
  event_id: string;
}

export function handleImportCodex(
  params: CodexImportToolParams,
  deps: ImportCodexDeps,
): MemoryImportCodexResponse {
  const captureMode = resolveCodexCaptureMode(deps.env);

  if (captureMode === 'off') {
    return {
      status: 'disabled',
      captureMode: 'off',
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0,
      filesScanned: 0,
      message: 'Codex import is disabled by LOCUS_CODEX_CAPTURE=off.',
    };
  }

  if (deps.db === undefined) {
    return {
      status: 'error',
      captureMode,
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: 1,
      filesScanned: 0,
      processed: 0,
      remaining: 0,
      message: 'Database adapter is required for Codex import.',
    };
  }

  try {
    const knownEventIds = loadIngestedCodexEventIds(deps.db);
    const inboxBefore = listJsonFiles(deps.inboxDir);

    const importMetrics = deps.importCodexSessionsToInbox({
      inboxDir: deps.inboxDir,
      captureMode,
      latestOnly: params.latestOnly,
      projectRoot: params.projectRoot,
      sessionId: params.sessionId,
      since: params.since,
      env: deps.env,
      shouldSkipEventId: (eventId) => knownEventIds.has(eventId),
    });

    let ingestMetrics: IngestMetrics = {
      processed: 0,
      skipped: 0,
      duplicates: 0,
      filtered: 0,
      errors: 0,
      durationMs: 0,
      remaining: 0,
    };
    let imported = 0;

    if (importMetrics.written > 0) {
      const currentRunEventIds = collectNewInboxEventIds(deps.inboxDir, inboxBefore);
      ingestMetrics = deps.processInbox(deps.inboxDir, deps.db, {
        batchLimit: 0,
        captureLevel: deps.captureLevel,
        fts5Available: deps.fts5Available,
      });
      const storedEventIds = loadIngestedCodexEventIds(deps.db);
      imported = Array.from(currentRunEventIds).filter((eventId) =>
        storedEventIds.has(eventId),
      ).length;
    }

    const skipped =
      importMetrics.skippedUnknown + importMetrics.skippedByCapture + importMetrics.skippedByFilter;
    const errors = importMetrics.errors + importMetrics.parseErrors + ingestMetrics.errors;

    return {
      status: 'ok',
      captureMode,
      imported,
      skipped,
      duplicates: importMetrics.duplicatePending,
      errors,
      filesScanned: importMetrics.filesScanned,
      latestSession: importMetrics.latestSession,
      processed: ingestMetrics.processed,
      remaining: ingestMetrics.remaining,
      message:
        imported > 0
          ? `Imported ${imported} Codex ${imported === 1 ? 'event' : 'events'} into memory.`
          : 'No new Codex events were imported.',
    };
  } catch (error) {
    return {
      status: 'error',
      captureMode,
      imported: 0,
      skipped: 0,
      duplicates: 0,
      errors: 1,
      filesScanned: 0,
      processed: 0,
      remaining: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveCodexCaptureMode(
  env: Record<string, string | undefined> = process.env,
): CodexImportCaptureMode {
  const value = env.LOCUS_CODEX_CAPTURE;
  return value === 'off' || value === 'metadata' || value === 'redacted' || value === 'full'
    ? value
    : 'metadata';
}

function loadIngestedCodexEventIds(db: DatabaseAdapter): Set<string> {
  const rows = db.all<EventIdRow>('SELECT event_id FROM ingest_log WHERE source = ?', ['codex']);
  return new Set(rows.map((row) => row.event_id));
}

function listJsonFiles(inboxDir: string): Set<string> {
  try {
    return new Set(readdirSync(inboxDir).filter((entry) => entry.endsWith('.json')));
  } catch {
    return new Set<string>();
  }
}

function collectNewInboxEventIds(inboxDir: string, before: Set<string>): Set<string> {
  const eventIds = new Set<string>();

  try {
    const files = readdirSync(inboxDir).filter((entry) => entry.endsWith('.json'));
    for (const file of files) {
      if (before.has(file)) {
        continue;
      }

      try {
        const parsed = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8')) as {
          event_id?: unknown;
        };
        if (typeof parsed.event_id === 'string' && parsed.event_id.length > 0) {
          eventIds.add(parsed.event_id);
        }
      } catch {
        // Best effort: malformed files are accounted for by processInbox / importer errors.
      }
    }
  } catch {
    return eventIds;
  }

  return eventIds;
}
