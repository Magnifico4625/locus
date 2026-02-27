// Locus Stop hook (v3 — Carbon Copy transcript parser)
// Parses Claude Code transcript JSONL to capture AI responses.
// Uses a session cursor (tailer-state.json) to read only new lines since last call.
// Only writes at captureLevel=redacted or captureLevel=full (never at metadata).
// Contract: NEVER crash. All errors are silently swallowed.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { redact } from './redact.js';
import {
  computeInboxDir,
  computeLocusDir,
  computeSourceEventId,
  generateEventId,
  resolveProjectRoot,
  writeAtomicInboxEvent,
} from './shared.js';

// ─── Transcript parsing ──────────────────────────────────────────────────────

/**
 * Parses an array of JSONL lines from a Claude Code transcript.
 * Extracts assistant messages with their text content and optional model.
 *
 * @param {string[]} lines — raw JSONL lines (may include malformed ones)
 * @returns {Array<{ role: string; text: string; model?: string }>}
 */
export function parseTranscriptLines(lines) {
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed JSONL lines
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    if (parsed.type !== 'assistant') continue;

    const message = parsed.message;
    if (!message || typeof message !== 'object') continue;

    // Extract text content — handles both string and array formats
    let text = '';
    const content = message.content;

    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      // Claude Code uses content blocks: [{type: "text", text: "..."}, ...]
      const textParts = [];
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          block.type === 'text' &&
          typeof block.text === 'string'
        ) {
          textParts.push(block.text);
        }
      }
      text = textParts.join('');
    }

    // Skip empty content
    if (text.length === 0) continue;

    const entry = { role: 'assistant', text };

    // Extract model if present
    if (typeof message.model === 'string' && message.model.length > 0) {
      entry.model = message.model;
    }

    results.push(entry);
  }

  return results;
}

// ─── Tailer state management ─────────────────────────────────────────────────

const TAILER_STATE_FILE = 'tailer-state.json';

/**
 * Loads the byte offset for a session from tailer-state.json.
 * Returns 0 if the file doesn't exist or the session is not found.
 *
 * @param {string} stateDir — directory containing tailer-state.json
 * @param {string} sessionId
 * @returns {number} byte offset
 */
export function loadTailerState(stateDir, sessionId) {
  try {
    const statePath = join(stateDir, TAILER_STATE_FILE);
    const content = JSON.parse(readFileSync(statePath, 'utf-8'));
    if (content && typeof content === 'object' && typeof content[sessionId] === 'number') {
      return content[sessionId];
    }
  } catch {
    // File doesn't exist or is corrupt — start from 0
  }
  return 0;
}

/**
 * Saves the byte offset for a session to tailer-state.json.
 * Preserves offsets for other sessions.
 *
 * @param {string} stateDir — directory containing tailer-state.json
 * @param {string} sessionId
 * @param {number} offset — byte offset
 */
export function saveTailerState(stateDir, sessionId, offset) {
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, TAILER_STATE_FILE);

  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, 'utf-8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      state = {};
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }

  state[sessionId] = offset;
  writeFileSync(statePath, JSON.stringify(state), 'utf-8');
}

// ─── Main hook ───────────────────────────────────────────────────────────────

/**
 * Stop hook — parses Claude Code transcript JSONL and writes ai_response events to inbox.
 * Uses tailer-state.json to track byte offset per session, processing only new lines.
 *
 * CaptureLevel gate: metadata = skip entirely (AI responses are private by default).
 *
 * @param {{ session_id?: string; transcript_path?: string; cwd?: string }} event
 * @returns {Promise<undefined>}
 */
export default async function stop(event) {
  try {
    const captureLevel = process.env.LOCUS_CAPTURE_LEVEL ?? 'metadata';

    // Validate captureLevel
    if (captureLevel !== 'metadata' && captureLevel !== 'redacted' && captureLevel !== 'full') {
      return undefined;
    }

    // CaptureLevel gate: AI responses are NOT captured at metadata or redacted level
    // Design doc: redacted level = "NO" for ai_response
    if (captureLevel === 'metadata' || captureLevel === 'redacted') {
      return undefined;
    }

    // Validate transcript_path exists
    const transcriptPath = typeof event?.transcript_path === 'string' ? event.transcript_path : '';
    if (transcriptPath.length === 0) {
      return undefined;
    }

    // Validate session_id
    const sessionId = typeof event?.session_id === 'string' ? event.session_id : '';

    // Resolve project paths
    const cwd = event?.cwd ?? process.env.PWD ?? process.cwd();
    const projectRoot = resolveProjectRoot(cwd);
    const inboxDir = computeInboxDir(projectRoot);
    const locusDir = computeLocusDir(projectRoot);

    // Get file size and load cursor
    let fileSize;
    try {
      fileSize = statSync(transcriptPath).size;
    } catch {
      // Transcript file doesn't exist
      return undefined;
    }

    const lastOffset = sessionId.length > 0 ? loadTailerState(locusDir, sessionId) : 0;

    // Nothing new to read
    if (lastOffset >= fileSize) {
      return undefined;
    }

    // Read new content from byte offset (Buffer-based for multi-byte UTF-8 safety)
    // Using Buffer ensures byte offset from statSync().size matches the slice position.
    // Without this, Cyrillic (2 bytes) or emoji (4 bytes) cause offset drift.
    const buffer = readFileSync(transcriptPath);
    const newBytes = buffer.subarray(lastOffset);
    const newContent = newBytes.toString('utf-8');

    if (newContent.trim().length === 0) {
      // Update offset even if no content (file might have trailing whitespace)
      if (sessionId.length > 0) {
        saveTailerState(locusDir, sessionId, buffer.length);
      }
      return undefined;
    }

    // Parse new JSONL lines
    const newLines = newContent.split('\n').filter((l) => l.trim().length > 0);
    const assistantMessages = parseTranscriptLines(newLines);

    // Write each assistant message as an ai_response event — redact secrets
    for (const msg of assistantMessages) {
      const eventId = generateEventId();
      const inboxEvent = {
        version: 1,
        event_id: eventId,
        source: 'claude-code',
        source_event_id: computeSourceEventId(sessionId, transcriptPath, String(lastOffset)),
        project_root: projectRoot,
        timestamp: Date.now(),
        kind: 'ai_response',
        payload: {
          response: redact(msg.text),
        },
      };

      if (msg.model) {
        inboxEvent.payload.model = msg.model;
      }

      if (sessionId.length > 0) {
        inboxEvent.session_id = sessionId;
      }

      writeAtomicInboxEvent(inboxDir, inboxEvent);
    }

    // Update cursor — use buffer.length (bytes) for consistency with byte-based reads
    if (sessionId.length > 0) {
      saveTailerState(locusDir, sessionId, buffer.length);
    }
  } catch {
    // NEVER crash — silently swallow all errors
  }

  return undefined;
}
