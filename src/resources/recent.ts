import type { DatabaseAdapter } from '../types.js';
import { estimateTokens } from '../utils.js';

// ─── Internal row type matching DB schema ─────────────────────────────────────

interface MemoryRow {
  id: number;
  content: string;
  created_at: number;
  session_id: string;
}

// ─── Session grouping ─────────────────────────────────────────────────────────

interface SessionData {
  sessionId: string;
  latestTimestamp: number;
  summary: string;
  files: string[];
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return days === 1 ? 'yesterday' : `${days} days ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// ─── File extraction from content ─────────────────────────────────────────────

const FILE_PATTERN = /\b[\w./-]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|php)\b/g;

function extractFiles(content: string): string[] {
  const matches = content.match(FILE_PATTERN);
  return matches ?? [];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateRecent(db: DatabaseAdapter): string {
  const rows = db.all<MemoryRow>(
    `SELECT id, content, created_at, session_id
     FROM memories
     WHERE layer = 'episodic' AND session_id IS NOT NULL
     ORDER BY created_at ASC`,
  );

  if (rows.length === 0) {
    return 'No sessions recorded. Start working and Locus will track.';
  }

  // Group entries by session_id; keep last entry as summary
  const sessionMap = new Map<string, SessionData>();

  for (const row of rows) {
    const sid = row.session_id;
    const existing = sessionMap.get(sid);

    const rowFiles = extractFiles(row.content);

    if (existing === undefined) {
      sessionMap.set(sid, {
        sessionId: sid,
        latestTimestamp: row.created_at,
        summary: row.content,
        files: rowFiles,
      });
    } else {
      // Update to latest entry (rows are ASC so later rows overwrite)
      existing.latestTimestamp = row.created_at;
      existing.summary = row.content;
      // Accumulate files across all entries
      for (const f of rowFiles) {
        if (!existing.files.includes(f)) {
          existing.files.push(f);
        }
      }
    }
  }

  // Sort sessions most recent first
  const sessions = [...sessionMap.values()].sort((a, b) => b.latestTimestamp - a.latestTimestamp);

  const MAX_SESSIONS = 5;
  const TOKEN_BUDGET = 1000;

  const lines: string[] = [];
  let sessionCount = 0;

  for (const session of sessions) {
    if (sessionCount >= MAX_SESSIONS) break;

    // Truncate summary to 120 chars
    const rawSummary =
      session.summary.length > 120 ? `${session.summary.slice(0, 117)}...` : session.summary;

    const time = relativeTime(session.latestTimestamp);
    const summaryLine = `Session ${sessionCount + 1} (${time}): ${rawSummary}`;

    // Format files line
    const MAX_FILES = 5;
    const dedupedFiles = [...new Set(session.files)];
    let filesStr: string;
    if (dedupedFiles.length === 0) {
      filesStr = '  Files: (none)';
    } else if (dedupedFiles.length <= MAX_FILES) {
      filesStr = `  Files: ${dedupedFiles.join(', ')}`;
    } else {
      const shown = dedupedFiles.slice(0, MAX_FILES);
      const extra = dedupedFiles.length - MAX_FILES;
      filesStr = `  Files: ${shown.join(', ')} + ${extra} more`;
    }

    const block = `${summaryLine}\n${filesStr}`;

    // Check token budget before adding
    const current = lines.join('\n');
    const candidate = current.length > 0 ? `${current}\n${block}` : block;
    if (estimateTokens(candidate) > TOKEN_BUDGET) break;

    lines.push(block);
    sessionCount++;
  }

  return lines.join('\n');
}
