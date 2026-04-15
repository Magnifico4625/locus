import { redactCodexText, shouldImportCodexEvent } from './capture.js';
import { createCodexEventId, createCodexSourceEventId } from './ids.js';
import type { CodexCaptureMode, CodexNormalizedEvent, CodexNormalizedKind } from './types.js';

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
  if (!shouldImportCodexEvent(captureMode, normalizedEvent.kind)) {
    return null;
  }

  const sourceEventId = createCodexSourceEventId({
    sessionId: normalizedEvent.sessionId,
    filePath: normalizedEvent.sourceFile,
    line: normalizedEvent.sourceLine,
    kind: normalizedEvent.kind,
    itemId: normalizedEvent.itemId,
  });

  return {
    version: 1,
    event_id: createCodexEventId(sourceEventId),
    source: 'codex',
    source_event_id: sourceEventId,
    project_root: normalizedEvent.projectRoot,
    session_id: normalizedEvent.sessionId,
    timestamp: normalizedEvent.timestamp,
    kind: normalizedEvent.kind,
    payload: toInboxPayload(normalizedEvent, captureMode),
  };
}

function toInboxPayload(
  normalizedEvent: CodexNormalizedEvent,
  captureMode: CodexCaptureMode,
): Record<string, unknown> {
  switch (normalizedEvent.kind) {
    case 'user_prompt':
      return {
        prompt: maybeRedact(stringPayload(normalizedEvent.payload.prompt), captureMode),
      };
    case 'ai_response':
      return compactPayload({
        response: stringPayload(normalizedEvent.payload.response),
        model: optionalString(normalizedEvent.payload.model),
      });
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
      return compactPayload({
        summary: optionalString(normalizedEvent.payload.summary),
      });
  }
}

function maybeRedact(value: string, captureMode: CodexCaptureMode): string {
  return captureMode === 'redacted' ? redactCodexText(value) : value;
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

function arrayPayload(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}
