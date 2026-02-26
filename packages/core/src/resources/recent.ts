import type { CaptureLevel, DatabaseAdapter } from '../types.js';
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

// ─── Conversation DB rows ─────────────────────────────────────────────────────

interface KindCountRow {
  kind: string;
  cnt: number;
}

interface RecentFileRow {
  file_path: string;
}

interface PromptRow {
  payload_json: string;
  timestamp: number;
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

// ─── Episodic sessions section ────────────────────────────────────────────────

function generateEpisodicSection(db: DatabaseAdapter, tokenBudget: number): string {
  const rows = db.all<MemoryRow>(
    `SELECT id, content, created_at, session_id
     FROM memories
     WHERE layer = 'episodic' AND session_id IS NOT NULL
     ORDER BY created_at ASC`,
  );

  if (rows.length === 0) return '';

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
      existing.latestTimestamp = row.created_at;
      existing.summary = row.content;
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

  const lines: string[] = [];
  let sessionCount = 0;

  for (const session of sessions) {
    if (sessionCount >= MAX_SESSIONS) break;

    const rawSummary =
      session.summary.length > 120 ? `${session.summary.slice(0, 117)}...` : session.summary;

    const time = relativeTime(session.latestTimestamp);
    const summaryLine = `Session ${sessionCount + 1} (${time}): ${rawSummary}`;

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

    const current = lines.join('\n');
    const candidate = current.length > 0 ? `${current}\n${block}` : block;
    if (estimateTokens(candidate) > tokenBudget) break;

    lines.push(block);
    sessionCount++;
  }

  return lines.join('\n');
}

// ─── Conversation stats section ───────────────────────────────────────────────

function generateConversationSection(
  db: DatabaseAdapter,
  captureLevel: CaptureLevel,
  tokenBudget: number,
): string {
  // Check if conversation_events table has any rows
  let totalCount: number;
  try {
    const row = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events');
    totalCount = row?.cnt ?? 0;
  } catch {
    return '';
  }

  if (totalCount === 0) return '';

  const lines: string[] = [];
  lines.push('── Conversation Activity ──────────────');

  // Event counts by kind
  const kindCounts = db.all<KindCountRow>(
    'SELECT kind, COUNT(*) AS cnt FROM conversation_events GROUP BY kind ORDER BY cnt DESC',
  );

  const kindParts = kindCounts.map((r) => `${r.cnt} ${r.kind}`);
  lines.push(`Events: ${totalCount} total (${kindParts.join(', ')})`);

  // Recent files from event_files (max 5 unique)
  const MAX_RECENT_FILES = 5;
  const recentFiles = db.all<RecentFileRow>(
    `SELECT DISTINCT ef.file_path
     FROM event_files ef
     JOIN conversation_events ce ON ce.event_id = ef.event_id
     ORDER BY ce.timestamp DESC
     LIMIT ?`,
    [MAX_RECENT_FILES],
  );

  if (recentFiles.length > 0) {
    lines.push(`Recent files: ${recentFiles.map((r) => r.file_path).join(', ')}`);
  }

  // Last 3 prompts (only at full or redacted captureLevel)
  if (captureLevel === 'full' || captureLevel === 'redacted') {
    const prompts = db.all<PromptRow>(
      `SELECT payload_json, timestamp
       FROM conversation_events
       WHERE kind = 'user_prompt' AND payload_json IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT 3`,
    );

    if (prompts.length > 0) {
      lines.push('Last prompts:');
      for (const p of prompts) {
        try {
          const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
          const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
          const truncated = prompt.length > 100 ? `${prompt.slice(0, 97)}...` : prompt;
          lines.push(`  - "${truncated}"`);
        } catch {
          // Skip malformed payload
        }
      }
    }
  }

  const section = lines.join('\n');
  if (estimateTokens(section) > tokenBudget) {
    // Trim to just counts if over budget
    return lines.slice(0, 2).join('\n');
  }

  return section;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateRecent(db: DatabaseAdapter, captureLevel?: CaptureLevel): string {
  const effectiveCapture = captureLevel ?? 'metadata';
  const TOKEN_BUDGET = 1000;

  // Part 1: Episodic sessions (allocate ~600 tokens)
  const episodicSection = generateEpisodicSection(db, 600);

  // Part 2: Conversation stats (allocate remaining budget)
  const episodicTokens = estimateTokens(episodicSection);
  const remainingBudget = TOKEN_BUDGET - episodicTokens - 10; // 10 token margin for separator
  const convSection =
    remainingBudget > 50 ? generateConversationSection(db, effectiveCapture, remainingBudget) : '';

  // Combine
  if (!episodicSection && !convSection) {
    return 'No sessions recorded. Start working and Locus will track.';
  }

  const parts: string[] = [];
  if (episodicSection) parts.push(episodicSection);
  if (convSection) parts.push(convSection);

  return parts.join('\n\n');
}
