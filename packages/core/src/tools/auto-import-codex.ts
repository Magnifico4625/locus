import { detectClientEnv } from '@locus/shared-runtime';
import type {
  CodexAutoImportSnapshot,
  CodexAutoImportStatus,
  MemoryImportCodexResponse,
} from '../types.js';

export const CODEX_AUTO_IMPORT_DEBOUNCE_MS = 45_000;

export interface CoordinateCodexAutoImportParams {
  now: number;
  snapshot: CodexAutoImportSnapshot;
  detectClientEnv?: typeof detectClientEnv;
  runImport: () => MemoryImportCodexResponse;
  debounceMs?: number;
}

export interface CodexAutoImportCoordinatorResult {
  snapshot: CodexAutoImportSnapshot;
  ranImport: boolean;
  processedInbox: boolean;
}

export function coordinateCodexAutoImport(
  params: CoordinateCodexAutoImportParams,
): CodexAutoImportCoordinatorResult {
  const debounceMs = params.debounceMs ?? CODEX_AUTO_IMPORT_DEBOUNCE_MS;
  const client = (params.detectClientEnv ?? detectClientEnv)();

  if (client !== 'codex') {
    return {
      snapshot: {
        ...params.snapshot,
        clientDetected: false,
        debounceMs,
        lastStatus: 'skipped_not_codex',
      },
      ranImport: false,
      processedInbox: false,
    };
  }

  if (
    params.snapshot.lastAttemptAt !== undefined &&
    params.now - params.snapshot.lastAttemptAt < debounceMs
  ) {
    return {
      snapshot: {
        ...params.snapshot,
        clientDetected: true,
        debounceMs,
        lastStatus: 'debounced',
      },
      ranImport: false,
      processedInbox: false,
    };
  }

  const baseSnapshot: CodexAutoImportSnapshot = {
    ...params.snapshot,
    clientDetected: true,
    debounceMs,
    lastAttemptAt: params.now,
  };

  try {
    const result = params.runImport();
    const nextSnapshot = applyImportResult(baseSnapshot, result, params.now);
    return {
      snapshot: nextSnapshot,
      ranImport: true,
      processedInbox: result.status === 'ok' && result.processed > 0,
    };
  } catch (error) {
    return {
      snapshot: {
        ...baseSnapshot,
        lastRunAt: params.now,
        lastStatus: 'error',
        lastImported: 0,
        lastDuplicates: 0,
        lastErrors: 1,
        latestSession: undefined,
        message: error instanceof Error ? error.message : String(error),
      },
      ranImport: true,
      processedInbox: false,
    };
  }
}

function applyImportResult(
  snapshot: CodexAutoImportSnapshot,
  result: MemoryImportCodexResponse,
  now: number,
): CodexAutoImportSnapshot {
  return {
    ...snapshot,
    lastRunAt: now,
    lastStatus: classifyStatus(result),
    lastImported: result.imported,
    lastDuplicates: result.duplicates,
    lastErrors: result.errors,
    latestSession: 'latestSession' in result ? result.latestSession : undefined,
    message: result.message,
  };
}

function classifyStatus(result: MemoryImportCodexResponse): CodexAutoImportStatus {
  if (result.status === 'disabled') {
    return 'disabled';
  }

  if (result.status === 'error') {
    return 'error';
  }

  if (result.imported > 0) {
    return 'imported';
  }

  if (result.duplicates > 0 && result.errors === 0) {
    return 'duplicates_only';
  }

  if (result.errors > 0) {
    return 'error';
  }

  return 'imported';
}
