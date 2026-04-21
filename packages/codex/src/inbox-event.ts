import { captureCodexEvent } from './capture.js';
import { createCodexEventId, createCodexSourceEventId } from './ids.js';
import type {
  CodexCaptureMode,
  CodexCapturePolicy,
  CodexCaptureReason,
  CodexNormalizedEvent,
  CodexNormalizedKind,
} from './types.js';

export interface LocusInboxEventV1 {
  version: 1;
  event_id: string;
  source: 'codex';
  source_event_id: string;
  project_root: string;
  session_id: string;
  timestamp: number;
  kind: CodexNormalizedKind;
  payload: Record<string, unknown>;
}

export function toInboxEvent(
  normalizedEvent: CodexNormalizedEvent,
  captureMode: CodexCaptureMode,
): LocusInboxEventV1 | null {
  const captured = captureCodexEvent(normalizedEvent, captureMode);
  if (!captured.event) {
    return null;
  }

  const sourceEventId = createCodexSourceEventId({
    sessionId: captured.event.sessionId,
    filePath: captured.event.sourceFile,
    line: captured.event.sourceLine,
    kind: captured.event.kind,
    itemId: captured.event.itemId,
  });

  return {
    version: 1,
    event_id: createCodexEventId(sourceEventId),
    source: 'codex',
    source_event_id: sourceEventId,
    project_root: captured.event.projectRoot,
    session_id: captured.event.sessionId,
    timestamp: captured.event.timestamp,
    kind: captured.event.kind,
    payload: toInboxPayload(captured.event, captured.capturePolicy, captured.captureReason),
  };
}

function toInboxPayload(
  normalizedEvent: CodexNormalizedEvent,
  capturePolicy: CodexCapturePolicy,
  captureReason?: CodexCaptureReason,
): Record<string, unknown> {
  switch (normalizedEvent.kind) {
    case 'user_prompt':
      return withCaptureMetadata(
        {
          prompt: stringPayload(normalizedEvent.payload.prompt),
        },
        capturePolicy,
        captureReason,
        optionalBoolean(normalizedEvent.payload.truncated),
      );
    case 'ai_response':
      return withCaptureMetadata(
        compactPayload({
          response: stringPayload(normalizedEvent.payload.response),
          model: optionalString(normalizedEvent.payload.model),
        }),
        capturePolicy,
        captureReason,
        optionalBoolean(normalizedEvent.payload.truncated),
      );
    case 'tool_use':
      return compactPayload({
        tool: optionalString(normalizedEvent.payload.tool) ?? 'unknown',
        files: arrayPayload(normalizedEvent.payload.files),
        status: optionalString(normalizedEvent.payload.status) ?? 'success',
        exitCode: optionalNumber(normalizedEvent.payload.exitCode),
      });
    case 'session_start':
      return compactPayload({
        tool: optionalString(normalizedEvent.payload.tool) ?? 'codex',
        model: optionalString(normalizedEvent.payload.model),
      });
    case 'session_end':
      return withCaptureMetadata(
        compactPayload({
          summary: optionalString(normalizedEvent.payload.summary),
        }),
        capturePolicy,
        captureReason,
        optionalBoolean(normalizedEvent.payload.truncated),
      );
  }
}

function withCaptureMetadata(
  payload: Record<string, unknown>,
  capturePolicy: CodexCapturePolicy,
  captureReason?: CodexCaptureReason,
  truncated?: boolean,
): Record<string, unknown> {
  if (capturePolicy !== 'bounded_redacted') {
    return payload;
  }

  return compactPayload({
    ...payload,
    capture_policy: capturePolicy,
    capture_reason: captureReason,
    truncated,
  });
}

function compactPayload(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function stringPayload(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function arrayPayload(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}
