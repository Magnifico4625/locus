import { statSync } from 'node:fs';
import { redact } from '../security/redact.js';
import type { CaptureLevel, DatabaseAdapter } from '../types.js';
import { estimateTokens } from '../utils.js';

export interface AuditDeps {
  db: DatabaseAdapter;
  projectPath: string;
  dbPath: string;
  logPath: string;
  captureLevel: CaptureLevel;
  fts5: boolean;
}

interface CountRow {
  cnt: number;
}

interface ExportsJsonRow {
  exports_json: string | null;
}

interface ImportsJsonRow {
  imports_json: string | null;
}

interface ContentRow {
  content: string;
  session_id: string | null;
}

interface HookCountRow {
  cnt: number;
}

function tableExists(db: DatabaseAdapter, name: string): boolean {
  const row = db.get<CountRow>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  );
  return (row?.cnt ?? 0) > 0;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function countArrayEntries(json: string | null): number {
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.length;
    return 0;
  } catch {
    return 0;
  }
}

export function handleAudit(deps: AuditDeps): string {
  const { db, projectPath, dbPath, logPath, captureLevel, fts5 } = deps;

  // File count
  const fileCount = db.get<CountRow>('SELECT COUNT(*) as cnt FROM files')?.cnt ?? 0;

  // Export count: sum lengths of all exports_json arrays
  const exportRows = db.all<ExportsJsonRow>(
    'SELECT exports_json FROM files WHERE exports_json IS NOT NULL',
  );
  const exportCount = exportRows.reduce((sum, row) => sum + countArrayEntries(row.exports_json), 0);

  // Import count: sum lengths of all imports_json arrays
  const importRows = db.all<ImportsJsonRow>(
    'SELECT imports_json FROM files WHERE imports_json IS NOT NULL',
  );
  const importCount = importRows.reduce((sum, row) => sum + countArrayEntries(row.imports_json), 0);

  // Semantic memory
  const semanticCount =
    db.get<CountRow>("SELECT COUNT(*) as cnt FROM memories WHERE layer = 'semantic'")?.cnt ?? 0;
  const semanticRows = db.all<ContentRow>(
    "SELECT content, session_id FROM memories WHERE layer = 'semantic'",
  );
  const semanticTokens = semanticRows.reduce((sum, row) => sum + estimateTokens(row.content), 0);

  // Episodic memory
  const episodicCount =
    db.get<CountRow>("SELECT COUNT(*) as cnt FROM memories WHERE layer = 'episodic'")?.cnt ?? 0;
  const episodicRows = db.all<ContentRow>(
    "SELECT content, session_id FROM memories WHERE layer = 'episodic'",
  );
  const episodicTokens = episodicRows.reduce((sum, row) => sum + estimateTokens(row.content), 0);

  // Count distinct session IDs for episodic rows (excluding null)
  const episodicSessionIds = new Set<string>();
  for (const row of episodicRows) {
    if (row.session_id !== null && row.session_id !== undefined) {
      episodicSessionIds.add(row.session_id);
    }
  }
  const episodicSessionCount = episodicSessionIds.size;

  // Hook captures
  const hookCount = db.get<HookCountRow>('SELECT COUNT(*) as cnt FROM hook_captures')?.cnt ?? 0;

  // DB and log sizes
  const dbBytes = getFileSize(dbPath);
  const logBytes = getFileSize(logPath);

  // Secrets detection: compare redact(content) !== content
  const allMemoryRows = db.all<ContentRow>('SELECT content, session_id FROM memories');
  let secretsFound = 0;
  for (const row of allMemoryRows) {
    if (redact(row.content) !== row.content) {
      secretsFound++;
    }
  }

  // Capture level description
  const captureLevelDesc =
    captureLevel === 'metadata'
      ? 'metadata (default — no file content stored)'
      : captureLevel === 'redacted'
        ? 'redacted (content stored with secrets removed)'
        : 'full (WARNING: raw content is being stored!)';

  // Build report
  const separator = '━'.repeat(Math.min(projectPath.length + 20, 60));

  const lines: string[] = [
    `Locus Memory Audit — ${projectPath}`,
    separator,
    `Capture level: ${captureLevelDesc}`,
    '',
    `Structural map:   ${fileCount} files, ${exportCount} exports, ${importCount} imports`,
    `Semantic memory:  ${semanticCount} ${semanticCount === 1 ? 'entry' : 'entries'} (${semanticTokens} tokens est.)`,
    `Episodic memory:  ${episodicCount} ${episodicCount === 1 ? 'entry' : 'entries'} across ${episodicSessionCount} ${episodicSessionCount === 1 ? 'session' : 'sessions'} (${episodicTokens} tokens est.)`,
    `Hook captures:   ${hookCount} events (${captureLevel === 'metadata' ? 'metadata only, no content' : captureLevel} capture)`,
    '',
    `DB size: ${formatSize(dbBytes)} at ${dbPath}`,
    `Log size: ${formatSize(logBytes)} at ${logPath}`,
    '',
  ];

  // FTS5 health check
  if (fts5) {
    const hasMemoFts = tableExists(db, 'memories_fts');
    const hasConvFts = tableExists(db, 'conversation_fts');
    if (hasMemoFts) {
      const ftsCount = db.get<CountRow>('SELECT COUNT(*) as cnt FROM memories_fts')?.cnt ?? 0;
      const totalMemories = semanticCount + episodicCount;
      if (totalMemories > 0 && ftsCount === 0) {
        lines.push(`WARNING: FTS5 index for memories is empty (${totalMemories} memories exist but 0 indexed). Run memory_doctor for repair.`);
      } else {
        lines.push(`FTS5 index: ${ftsCount} memories indexed (semantic+episodic).`);
      }
    } else {
      lines.push('WARNING: memories_fts table missing. Restart MCP server to auto-create.');
    }

    if (hasConvFts) {
      const convEventCount = db.get<CountRow>('SELECT COUNT(*) as cnt FROM conversation_events')?.cnt ?? 0;
      const convFtsCount = db.get<CountRow>('SELECT COUNT(*) as cnt FROM conversation_fts')?.cnt ?? 0;
      if (convEventCount > 0 && convFtsCount === 0) {
        lines.push(`WARNING: FTS5 index for conversation events is empty (${convEventCount} events exist but 0 indexed).`);
      } else {
        lines.push(`FTS5 conversation index: ${convFtsCount}/${convEventCount} events indexed.`);
      }
    } else {
      lines.push('WARNING: conversation_fts table missing. Restart MCP server to auto-create.');
    }
    lines.push('');
  }

  if (secretsFound > 0) {
    lines.push(
      `WARNING: ${secretsFound} memory ${secretsFound === 1 ? 'entry contains' : 'entries contain'} potential secrets — run memory_purge() to clear.`,
    );
  } else {
    lines.push('No secrets detected in stored data.');
  }

  if (captureLevel === 'metadata') {
    lines.push("Capture level is 'metadata' — no raw file content is stored.");
  } else if (captureLevel === 'redacted') {
    lines.push("Capture level is 'redacted' — content is stored with secrets removed.");
  } else {
    lines.push(
      "WARNING: Capture level is 'full' — raw file content is being stored. Consider switching to 'metadata' or 'redacted'.",
    );
  }

  return lines.join('\n');
}
