import { closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs';
import {
  findCodexRolloutFiles,
  getCodexCaptureMode,
  parseCodexJsonl,
  resolveCodexSessionsDir,
} from '@locus/codex';
import { detectClientRuntime, normalizePathForIdentity } from '@locus/shared-runtime';
import type { CodexDiagnosticsSnapshot, DatabaseAdapter } from '../types.js';

export interface CodexDiagnosticsDeps {
  db: DatabaseAdapter;
  env?: Record<string, string | undefined>;
}

interface CountRow {
  cnt: number;
}

interface LatestImportedRow {
  session_id: string | null;
  timestamp: number;
}

export function collectCodexDiagnostics(
  deps: CodexDiagnosticsDeps,
): CodexDiagnosticsSnapshot | undefined {
  const env = deps.env ?? process.env;
  const codexHome = env.CODEX_HOME;
  if (!codexHome || codexHome.trim().length === 0) {
    return undefined;
  }

  const runtime = detectClientRuntime(env);
  const captureMode = getCodexCaptureMode(env);
  const sessionsDir = resolveCodexSessionsDir({ env });
  const sessionsDirExists = existsSync(sessionsDir);
  const rolloutFiles = sessionsDirExists ? findCodexRolloutFiles(sessionsDir) : [];
  const latestRolloutPath = rolloutFiles.at(-1);
  let latestRolloutTimestamp: number | undefined;
  if (latestRolloutPath) {
    latestRolloutTimestamp =
      latestCodexRolloutEventTimestamp(latestRolloutPath) ??
      latestCodexRolloutMtime(latestRolloutPath);
  }

  const importedEventCount =
    deps.db.get<CountRow>('SELECT COUNT(*) AS cnt FROM ingest_log WHERE source = ?', ['codex'])
      ?.cnt ?? 0;

  const latestImported = deps.db.get<LatestImportedRow>(
    `SELECT session_id, timestamp
     FROM conversation_events
     WHERE source = ?
     ORDER BY timestamp DESC, id DESC
     LIMIT 1`,
    ['codex'],
  );

  return {
    client: runtime.client,
    clientSurface: runtime.surface,
    detectionEvidence: [...runtime.evidence],
    captureMode,
    sessionsDir: normalizePathForIdentity(sessionsDir),
    sessionsDirExists,
    rolloutFilesFound: rolloutFiles.length,
    latestRolloutPath: latestRolloutPath ? normalizePathForIdentity(latestRolloutPath) : undefined,
    latestRolloutReadable: latestRolloutPath ? isReadable(latestRolloutPath) : undefined,
    latestRolloutTimestamp,
    importedEventCount,
    latestImportedSessionId: latestImported?.session_id ?? undefined,
    latestImportedTimestamp: latestImported?.timestamp,
  };
}

function isReadable(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r');
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function timestampFromValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function latestCodexRolloutEventTimestamp(filePath: string): number | undefined {
  try {
    const parsed = parseCodexJsonl(readFileSync(filePath, 'utf8'), filePath);
    const timestamps = parsed.records
      .map((record) => timestampFromValue(record.raw.timestamp))
      .filter((timestamp): timestamp is number => timestamp !== undefined);
    return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  } catch {
    return undefined;
  }
}

function latestCodexRolloutMtime(filePath: string): number | undefined {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}
