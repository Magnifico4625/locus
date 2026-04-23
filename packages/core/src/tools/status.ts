import { readdirSync, statSync } from 'node:fs';
import { DurableMemoryStore } from '../memory/durable.js';
import type {
  CaptureLevel,
  CodexAutoImportSnapshot,
  CodexDiagnosticsSnapshot,
  CodexTruthSnapshot,
  DatabaseAdapter,
  LocusConfig,
  MemoryStatus,
  ProjectRootMethod,
} from '../types.js';
import { CODEX_AUTO_IMPORT_DEBOUNCE_MS } from './auto-import-codex.js';

export interface StatusDeps {
  projectPath: string;
  projectRoot: string;
  projectRootMethod: ProjectRootMethod;
  dbPath: string;
  db: DatabaseAdapter;
  config: LocusConfig;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
  inboxDir?: string;
  codexAutoImportSnapshot?: CodexAutoImportSnapshot;
  codexDiagnostics?: CodexDiagnosticsSnapshot;
}

interface CountRow {
  cnt: number;
}

interface ValueRow {
  value: string;
}

function getDefaultCodexAutoImportSnapshot(): CodexAutoImportSnapshot {
  return {
    clientDetected: false,
    client: 'generic',
    clientSurface: 'generic',
    detectionEvidence: [],
    debounceMs: CODEX_AUTO_IMPORT_DEBOUNCE_MS,
    lastStatus: 'idle',
    lastImported: 0,
    lastDuplicates: 0,
    lastErrors: 0,
  };
}

function buildCodexTruth(
  codexDiagnostics: CodexDiagnosticsSnapshot | undefined,
): CodexTruthSnapshot | undefined {
  if (!codexDiagnostics) {
    return undefined;
  }

  const desktopMessage =
    'Codex CLI is the validated Track A path; Codex desktop/extension parity is unverified and may differ.';

  if (codexDiagnostics.captureMode === 'off') {
    return {
      recallReadiness: 'disabled',
      recommendedCaptureMode: 'redacted',
      desktopParity: 'unverified',
      recallMessage:
        'Codex capture is off, so Locus cannot import Codex conversation events for recall.',
      desktopMessage,
    };
  }

  if (codexDiagnostics.captureMode === 'metadata') {
    return {
      recallReadiness: 'limited',
      recommendedCaptureMode: 'redacted',
      desktopParity: 'unverified',
      recallMessage:
        'metadata capture imports structural session events and diagnostics, but conversational recall is intentionally limited.',
      desktopMessage,
    };
  }

  if (codexDiagnostics.captureMode === 'redacted') {
    return {
      recallReadiness: 'practical',
      recommendedCaptureMode: 'redacted',
      desktopParity: 'unverified',
      recallMessage:
        'redacted capture stores bounded, filtered conversation snippets for practical recall without full transcripts.',
      desktopMessage,
    };
  }

  return {
    recallReadiness: 'maximum',
    recommendedCaptureMode: 'redacted',
    desktopParity: 'unverified',
    recallMessage:
      'full capture stores raw conversation content and can provide maximum recall, but it is explicit warning territory.',
    desktopMessage,
  };
}

/**
 * Collects runtime status information about the Locus database and project.
 * All DB queries are read-only; the function never mutates state.
 */
export function handleStatus(deps: StatusDeps): MemoryStatus {
  const { db, dbPath, config } = deps;
  const durable = new DurableMemoryStore(db, false);

  // ── File counts ─────────────────────────────────────────────────────────────

  const totalFilesRow = db.get<CountRow>('SELECT COUNT(*) AS cnt FROM files');
  const totalFiles = totalFilesRow?.cnt ?? 0;

  const skippedFilesRow = db.get<CountRow>(
    'SELECT COUNT(*) AS cnt FROM files WHERE skipped_reason IS NOT NULL',
  );
  const skippedFiles = skippedFilesRow?.cnt ?? 0;

  // ── Memory counts ────────────────────────────────────────────────────────────

  const totalMemoriesRow = db.get<CountRow>(
    "SELECT COUNT(*) AS cnt FROM memories WHERE layer = 'semantic'",
  );
  const totalMemories = totalMemoriesRow?.cnt ?? 0;

  const totalEpisodesRow = db.get<CountRow>(
    "SELECT COUNT(*) AS cnt FROM memories WHERE layer = 'episodic'",
  );
  const totalEpisodes = totalEpisodesRow?.cnt ?? 0;
  const durableMemoryStates = durable.countByState();

  // ── Scan state ───────────────────────────────────────────────────────────────

  const lastScanRow = db.get<ValueRow>("SELECT value FROM scan_state WHERE key = 'lastScan'");
  const lastScan = lastScanRow ? Number(lastScanRow.value) : 0;

  const lastStrategyRow = db.get<ValueRow>(
    "SELECT value FROM scan_state WHERE key = 'lastStrategy'",
  );
  const scanStrategy = lastStrategyRow?.value ?? 'unknown';

  // ── Conversation events ───────────────────────────────────────────────────────

  let totalConversationEvents = 0;
  try {
    const ceRow = db.get<CountRow>('SELECT COUNT(*) AS cnt FROM conversation_events');
    totalConversationEvents = ceRow?.cnt ?? 0;
  } catch {
    totalConversationEvents = 0;
  }

  // ── Inbox pending ─────────────────────────────────────────────────────────────

  let inboxPending = 0;
  if (deps.inboxDir) {
    try {
      const entries = readdirSync(deps.inboxDir);
      inboxPending = entries.filter((f) => f.endsWith('.json')).length;
    } catch {
      inboxPending = 0;
    }
  }

  // ── DB file size ─────────────────────────────────────────────────────────────

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch {
    dbSizeBytes = 0;
  }

  return {
    projectPath: deps.projectPath,
    projectRoot: deps.projectRoot,
    projectRootMethod: deps.projectRootMethod,
    dbPath,
    dbSizeBytes,
    captureLevel: config.captureLevel as CaptureLevel,
    totalFiles,
    skippedFiles,
    totalMemories,
    totalEpisodes,
    totalConversationEvents,
    inboxPending,
    lastScan,
    scanStrategy,
    nodeVersion: process.version,
    storageBackend: deps.backend,
    fts5Available: deps.fts5,
    searchEngine: deps.fts5 ? 'FTS5' : 'LIKE fallback',
    durableMemoryStates,
    codexAutoImport: deps.codexAutoImportSnapshot
      ? { ...deps.codexAutoImportSnapshot }
      : getDefaultCodexAutoImportSnapshot(),
    codexDiagnostics: deps.codexDiagnostics ? { ...deps.codexDiagnostics } : undefined,
    codexTruth: buildCodexTruth(deps.codexDiagnostics),
  };
}
