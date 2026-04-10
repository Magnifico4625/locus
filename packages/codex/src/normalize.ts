import type {
  CodexJsonlRecord,
  CodexNormalizeResult,
  CodexNormalizedEvent,
} from './types.js';

const UNKNOWN_SESSION = 'unknown-session';

export function normalizeCodexRecords(records: readonly CodexJsonlRecord[]): CodexNormalizeResult {
  const events: CodexNormalizedEvent[] = [];
  let skipped = 0;
  let currentSessionId = UNKNOWN_SESSION;
  let currentProjectRoot = process.cwd();
  let currentModel: string | undefined;

  for (const record of records) {
    const raw = record.raw;
    const type = stringValue(raw.type);

    if (type === 'session_meta') {
      currentSessionId = stringValue(raw.session_id) ?? currentSessionId;
      currentProjectRoot = stringValue(raw.cwd) ?? currentProjectRoot;
      currentModel = stringValue(raw.model) ?? currentModel;

      events.push(
        createEvent(record, {
          kind: 'session_start',
          sessionId: currentSessionId,
          projectRoot: currentProjectRoot,
          payload: compactPayload({
            tool: 'codex',
            model: currentModel,
          }),
        }),
      );
      continue;
    }

    const sessionId = stringValue(raw.session_id) ?? currentSessionId;
    const projectRoot = stringValue(raw.cwd) ?? currentProjectRoot;

    if (type === 'event_msg') {
      const normalized = normalizeEventMessage(record, sessionId, projectRoot);
      if (normalized) {
        events.push(normalized);
      } else {
        skipped++;
      }
      continue;
    }

    if (type === 'response_item') {
      const normalized = normalizeResponseItem(record, sessionId, projectRoot, currentModel);
      if (normalized) {
        events.push(normalized);
      } else {
        skipped++;
      }
      continue;
    }

    skipped++;
  }

  return { events, skipped };
}

function normalizeEventMessage(
  record: CodexJsonlRecord,
  sessionId: string,
  projectRoot: string,
): CodexNormalizedEvent | undefined {
  const subtype = stringValue(record.raw.subtype);

  if (subtype === 'user_message') {
    return createEvent(record, {
      kind: 'user_prompt',
      sessionId,
      projectRoot,
      payload: {
        prompt: firstString(record.raw.message, record.raw.text) ?? '',
      },
    });
  }

  if (subtype === 'task_complete') {
    const summary = firstString(record.raw.summary, record.raw.message, record.raw.text);
    return createEvent(record, {
      kind: 'session_end',
      sessionId,
      projectRoot,
      payload: compactPayload({ summary }),
    });
  }

  if (subtype === 'exec_command_end') {
    const exitCode = numberValue(record.raw.exit_code);
    return createEvent(record, {
      kind: 'tool_use',
      sessionId,
      projectRoot,
      itemId: stringValue(record.raw.call_id),
      payload: compactPayload({
        tool: 'exec_command_end',
        callId: stringValue(record.raw.call_id),
        exitCode,
        durationMs: numberValue(record.raw.duration_ms),
        status: exitCode === undefined || exitCode === 0 ? 'success' : 'error',
      }),
    });
  }

  return undefined;
}

function normalizeResponseItem(
  record: CodexJsonlRecord,
  sessionId: string,
  projectRoot: string,
  currentModel: string | undefined,
): CodexNormalizedEvent | undefined {
  const item = recordObject(record.raw.item);
  if (!item) {
    return undefined;
  }

  const itemType = stringValue(item.type);

  if (itemType === 'message' && stringValue(item.role) === 'assistant') {
    return createEvent(record, {
      kind: 'ai_response',
      sessionId,
      projectRoot,
      payload: compactPayload({
        response: extractTextContent(item.content),
        model: currentModel,
      }),
    });
  }

  if (itemType === 'function_call') {
    const callId = stringValue(item.call_id);
    return createEvent(record, {
      kind: 'tool_use',
      sessionId,
      projectRoot,
      itemId: callId,
      payload: compactPayload({
        tool: stringValue(item.name) ?? 'function_call',
        callId,
        arguments: stringValue(item.arguments),
      }),
    });
  }

  if (itemType === 'function_call_output') {
    const callId = stringValue(item.call_id);
    return createEvent(record, {
      kind: 'tool_use',
      sessionId,
      projectRoot,
      itemId: callId,
      payload: compactPayload({
        tool: 'function_call_output',
        callId,
        output: stringValue(item.output),
      }),
    });
  }

  return undefined;
}

function createEvent(
  record: CodexJsonlRecord,
  input: Omit<CodexNormalizedEvent, 'sourceFile' | 'sourceLine' | 'timestamp'>,
): CodexNormalizedEvent {
  return {
    ...input,
    timestamp: timestampValue(record.raw.timestamp),
    sourceFile: record.filePath,
    sourceLine: record.line,
  };
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (!isRecordObject(entry)) {
        return undefined;
      }

      const text = stringValue(entry.text);
      if (text === undefined) {
        return undefined;
      }

      const type = stringValue(entry.type);
      return type === undefined || type === 'output_text' || type === 'text' ? text : undefined;
    })
    .filter((entry): entry is string => entry !== undefined)
    .join('\n');
}

function timestampValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function recordObject(value: unknown): Record<string, unknown> | undefined {
  return isRecordObject(value) ? value : undefined;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
