import { closeSync, existsSync, openSync } from 'node:fs';
import { findCodexRolloutFiles, getCodexCaptureMode, resolveCodexSessionsDir } from '@locus/codex';
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
    latestRolloutPath: latestRolloutPath
      ? normalizePathForIdentity(latestRolloutPath)
      : undefined,
    latestRolloutReadable: latestRolloutPath ? isReadable(latestRolloutPath) : undefined,
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
