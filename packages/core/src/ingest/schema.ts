import type { EventKind, InboxEvent } from '../types.js';

const VALID_EVENT_KINDS: ReadonlySet<string> = new Set<EventKind>([
  'user_prompt',
  'ai_response',
  'tool_use',
  'file_diff',
  'session_start',
  'session_end',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1;
}

function isValidEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && VALID_EVENT_KINDS.has(value);
}

/**
 * Validates raw JSON against the InboxEvent v1 schema.
 * Returns a typed InboxEvent on success, null on failure.
 * Never throws — callers can safely use in pipeline without try/catch.
 */
export function validateInboxEvent(json: unknown): InboxEvent | null {
  if (!isPlainRecord(json)) {
    return null;
  }

  if (json.version !== 1) {
    return null;
  }

  if (
    !isNonEmptyString(json.event_id) ||
    !isNonEmptyString(json.source) ||
    !isNonEmptyString(json.project_root)
  ) {
    return null;
  }

  if (json.source_event_id !== undefined && typeof json.source_event_id !== 'string') {
    return null;
  }

  if (json.session_id !== undefined && typeof json.session_id !== 'string') {
    return null;
  }

  if (
    typeof json.timestamp !== 'number' ||
    !Number.isSafeInteger(json.timestamp) ||
    json.timestamp <= 0
  ) {
    return null;
  }

  if (!isValidEventKind(json.kind) || !isPlainRecord(json.payload)) {
    return null;
  }

  const event: InboxEvent = {
    version: 1,
    event_id: json.event_id,
    source: json.source,
    project_root: json.project_root,
    timestamp: json.timestamp,
    kind: json.kind,
    payload: json.payload,
  };

  if (json.source_event_id !== undefined) {
    event.source_event_id = json.source_event_id;
  }

  if (json.session_id !== undefined) {
    event.session_id = json.session_id;
  }

  return event;
}
