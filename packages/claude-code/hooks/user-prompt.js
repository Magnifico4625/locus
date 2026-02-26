// Locus UserPromptSubmit hook (v3 — Carbon Copy)
// Captures user prompts to the inbox directory for the ingest pipeline.
// Only writes at captureLevel=redacted or captureLevel=full (never at metadata).
// Contract: NEVER crash. All errors are silently swallowed.

import {
  computeInboxDir,
  generateEventId,
  resolveProjectRoot,
  writeAtomicInboxEvent,
} from './shared.js';

/**
 * UserPromptSubmit hook — writes a user_prompt InboxEvent to the project inbox.
 * CaptureLevel gate: metadata = skip entirely (prompts are private by default).
 *
 * @param {{ prompt?: string; session_id?: string; cwd?: string }} event
 * @returns {Promise<undefined>}
 */
export default async function userPromptSubmit(event) {
  try {
    const captureLevel = process.env.LOCUS_CAPTURE_LEVEL ?? 'metadata';

    // Validate captureLevel
    if (captureLevel !== 'metadata' && captureLevel !== 'redacted' && captureLevel !== 'full') {
      return undefined;
    }

    // CaptureLevel gate: prompts are NOT captured at metadata level
    if (captureLevel === 'metadata') {
      return undefined;
    }

    // Validate prompt exists
    const prompt = typeof event?.prompt === 'string' ? event.prompt : '';
    if (prompt.length === 0) {
      return undefined;
    }

    const cwd = event?.cwd ?? process.env.PWD ?? process.cwd();
    const projectRoot = resolveProjectRoot(cwd);
    const inboxDir = computeInboxDir(projectRoot);

    // Build InboxEvent
    const eventId = generateEventId();
    const inboxEvent = {
      version: 1,
      event_id: eventId,
      source: 'claude-code',
      project_root: projectRoot,
      timestamp: Date.now(),
      kind: 'user_prompt',
      payload: {
        prompt,
      },
    };

    // Add session_id if available
    if (typeof event?.session_id === 'string' && event.session_id.length > 0) {
      inboxEvent.session_id = event.session_id;
    }

    // Atomic write to inbox
    writeAtomicInboxEvent(inboxDir, inboxEvent);
  } catch {
    // NEVER crash — silently swallow all errors
  }

  return undefined;
}
