import type { CaptureLevel, DatabaseAdapter, EventSignificance, InboxEvent } from '../types.js';

/**
 * CaptureLevel gate — second defense layer (hooks are first).
 *
 * At `metadata` level, only structural events (tool_use, file_diff,
 * session_start, session_end) are allowed. Content events (user_prompt,
 * ai_response) are blocked — they should never reach the inbox at
 * metadata level, but this catches hook malfunctions.
 *
 * At `redacted` level, ai_response is blocked (second defense —
 * the stop hook should already skip at redacted, but this catches
 * hook malfunctions). user_prompt is allowed (contains keywords only).
 *
 * At `full` level, all event kinds pass through.
 */
export function captureLevelGate(event: InboxEvent, captureLevel: CaptureLevel): boolean {
  if (captureLevel === 'metadata') {
    return event.kind !== 'user_prompt' && event.kind !== 'ai_response';
  }
  if (captureLevel === 'redacted') {
    return event.kind !== 'ai_response';
  }
  return true;
}

/** Minimum word count thresholds for prompt significance. */
const PROMPT_LOW_THRESHOLD = 5;
const PROMPT_HIGH_THRESHOLD = 50;

/** Tools that create or modify files → high significance. */
const HIGH_SIG_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/**
 * Classifies event significance based on content heuristics.
 *
 * - user_prompt: <5 words=low, 5-50=medium, >50=high
 * - tool_use: Write/Edit/error=high, others=medium
 * - file_diff: medium
 * - ai_response: medium
 * - session_start/end: low
 */
export function classifySignificance(event: InboxEvent): EventSignificance {
  const payload = event.payload;

  switch (event.kind) {
    case 'user_prompt': {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < PROMPT_LOW_THRESHOLD) return 'low';
      if (wordCount > PROMPT_HIGH_THRESHOLD) return 'high';
      return 'medium';
    }

    case 'tool_use': {
      const tool = typeof payload.tool === 'string' ? payload.tool : '';
      const status = typeof payload.status === 'string' ? payload.status : '';

      // Error status (test failures, crashes) = high
      if (status === 'error') return 'high';
      // File creation/modification tools = high
      if (HIGH_SIG_TOOLS.has(tool)) return 'high';
      return 'medium';
    }

    case 'file_diff':
      return 'medium';

    case 'ai_response':
      return 'medium';

    case 'session_start':
    case 'session_end':
      return 'low';

    default:
      return 'medium';
  }
}

/** Dedup time window: 5 minutes in milliseconds. */
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Similarity-based dedup — checks if a near-identical event
 * exists within a 5-minute window.
 *
 * Only applies to:
 * - user_prompt: same prompt text within window
 * - file_diff: same file path within window
 *
 * Other event kinds are never deduped (tool_use, ai_response, sessions).
 */
export function shouldDedup(event: InboxEvent, db: DatabaseAdapter): boolean {
  if (event.kind === 'user_prompt') {
    return dedupPrompt(event, db);
  }

  if (event.kind === 'file_diff') {
    return dedupFileDiff(event, db);
  }

  return false;
}

function dedupPrompt(event: InboxEvent, db: DatabaseAdapter): boolean {
  const prompt = typeof event.payload.prompt === 'string' ? event.payload.prompt : '';
  if (!prompt) return false;

  const windowStart = event.timestamp - DEDUP_WINDOW_MS;

  const row = db.get<{ id: number }>(
    `SELECT id FROM conversation_events
     WHERE kind = 'user_prompt'
       AND timestamp >= ?
       AND payload_json LIKE ? ESCAPE '\\'
     LIMIT 1`,
    [windowStart, `%${escapeForLike(prompt)}%`],
  );

  return row !== undefined;
}

function dedupFileDiff(event: InboxEvent, db: DatabaseAdapter): boolean {
  const path = typeof event.payload.path === 'string' ? event.payload.path : '';
  if (!path) return false;

  const windowStart = event.timestamp - DEDUP_WINDOW_MS;

  const row = db.get<{ id: number }>(
    `SELECT id FROM conversation_events
     WHERE kind = 'file_diff'
       AND timestamp >= ?
       AND payload_json LIKE ? ESCAPE '\\'
     LIMIT 1`,
    [windowStart, `%${escapeForLike(path)}%`],
  );

  return row !== undefined;
}

/** Escape special LIKE characters to prevent injection. */
function escapeForLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
