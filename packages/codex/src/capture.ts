import { boundCodexSnippet } from './bounded-snippets.js';
import { classifyCodexRelevance } from './relevance.js';
import type {
  CodexAiResponsePayload,
  CodexCaptureDecision,
  CodexCaptureMode,
  CodexCapturePolicy,
  CodexCaptureReason,
  CodexNormalizedEvent,
  CodexNormalizedKind,
  CodexSessionEndPayload,
  CodexUserPromptPayload,
} from './types.js';

const VALID_CAPTURE_MODES = new Set<CodexCaptureMode>(['off', 'metadata', 'redacted', 'full']);

export function getCodexCaptureMode(
  env: Record<string, string | undefined> = process.env,
): CodexCaptureMode {
  const value = env.LOCUS_CODEX_CAPTURE;
  return isCodexCaptureMode(value) ? value : 'metadata';
}

export function shouldImportCodexEvent(mode: CodexCaptureMode, kind: CodexNormalizedKind): boolean {
  if (mode === 'off') {
    return false;
  }

  if (mode === 'metadata') {
    return kind !== 'user_prompt' && kind !== 'ai_response';
  }

  if (mode === 'redacted') {
    return true;
  }

  return true;
}

export function captureCodexEvent(
  event: CodexNormalizedEvent,
  mode: CodexCaptureMode,
): CodexCaptureDecision {
  if (!shouldImportCodexEvent(mode, event.kind)) {
    return {
      event: null,
      capturePolicy: mode,
      truncated: false,
      retained: false,
      filtered: true,
    };
  }

  if (mode === 'metadata') {
    if (event.kind === 'user_prompt' || event.kind === 'ai_response') {
      return {
        event: null,
        capturePolicy: 'metadata',
        truncated: false,
        retained: false,
        filtered: true,
      };
    }

    return {
      event: annotateEvent(event, {
        capturePolicy: 'metadata',
        truncated: false,
        retained: true,
        filtered: false,
      }),
      capturePolicy: 'metadata',
      truncated: false,
      retained: true,
      filtered: false,
    };
  }

  if (mode === 'full') {
    return keepFullEvent(event);
  }

  return keepBoundedRedactedEvent(event);
}

// Best-effort redaction for common secret shapes; this is not a complete DLP guarantee.
export function redactCodexText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(
      /\b(password|passwd|secret|api[_-]?key|token)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi,
      (_match: string, key: string, separator: string) => `${key}${separator}[REDACTED]`,
    );
}

function isCodexCaptureMode(value: string | undefined): value is CodexCaptureMode {
  return value !== undefined && VALID_CAPTURE_MODES.has(value as CodexCaptureMode);
}

function keepFullEvent(event: CodexNormalizedEvent): CodexCaptureDecision {
  if (event.kind === 'user_prompt') {
    const prompt = redactCodexText(stringValue(event.payload.prompt));
    return keepDecision(
      annotateEvent(event, {
        prompt,
        capturePolicy: 'full',
        truncated: false,
        retained: true,
        filtered: false,
      } satisfies CodexUserPromptPayload),
      'full',
    );
  }

  if (event.kind === 'ai_response') {
    const response = redactCodexText(stringValue(event.payload.response));
    return keepDecision(
      annotateEvent(event, {
        response,
        model: optionalString(event.payload.model),
        capturePolicy: 'full',
        truncated: false,
        retained: true,
        filtered: false,
      } satisfies CodexAiResponsePayload),
      'full',
    );
  }

  if (event.kind === 'session_end') {
    return keepDecision(
      annotateEvent(event, {
        summary: maybeRedactSummary(event.payload.summary),
        capturePolicy: 'full',
        truncated: false,
        retained: true,
        filtered: false,
      } satisfies CodexSessionEndPayload),
      'full',
    );
  }

  return keepDecision(
    annotateEvent(event, {
      capturePolicy: 'full',
      truncated: false,
      retained: true,
      filtered: false,
    }),
    'full',
  );
}

function keepBoundedRedactedEvent(event: CodexNormalizedEvent): CodexCaptureDecision {
  if (event.kind === 'user_prompt') {
    return keepBoundedTextEvent(event, 'prompt', 'user');
  }

  if (event.kind === 'ai_response') {
    return keepBoundedTextEvent(event, 'response', 'assistant');
  }

  if (event.kind === 'session_end') {
    return keepDecision(
      annotateEvent(event, {
        summary: maybeRedactSummary(event.payload.summary),
        capturePolicy: 'bounded_redacted',
        captureReason: 'general_context',
        truncated: false,
        retained: true,
        filtered: false,
      } satisfies CodexSessionEndPayload),
      'bounded_redacted',
      'general_context',
    );
  }

  return keepDecision(
    annotateEvent(event, {
      capturePolicy: 'bounded_redacted',
      truncated: false,
      retained: true,
      filtered: false,
    }),
    'bounded_redacted',
  );
}

function keepBoundedTextEvent(
  event: CodexNormalizedEvent,
  payloadKey: 'prompt' | 'response',
  role: 'user' | 'assistant',
): CodexCaptureDecision {
  const originalText = stringValue(event.payload[payloadKey]);
  const redactedText = redactCodexText(originalText);
  const relevance = classifyCodexRelevance(redactedText, role);

  if (!relevance.keep) {
    return {
      event: null,
      capturePolicy: 'bounded_redacted',
      captureReason: relevance.reason,
      truncated: false,
      retained: false,
      filtered: true,
    };
  }

  if (role === 'assistant' && relevance.reason === 'general_context') {
    return {
      event: null,
      capturePolicy: 'bounded_redacted',
      captureReason: 'noise',
      truncated: false,
      retained: false,
      filtered: true,
    };
  }

  const snippet = boundCodexSnippet(redactedText, {
    role,
    reason: relevance.reason,
  });

  if (payloadKey === 'prompt') {
    return keepDecision(
      annotateEvent(event, {
        prompt: snippet.text,
        capturePolicy: 'bounded_redacted',
        captureReason: relevance.reason,
        truncated: snippet.truncated,
        retained: true,
        filtered: false,
      } satisfies CodexUserPromptPayload),
      'bounded_redacted',
      relevance.reason,
      snippet.truncated,
    );
  }

  return keepDecision(
    annotateEvent(event, {
      response: snippet.text,
      model: optionalString(event.payload.model),
      capturePolicy: 'bounded_redacted',
      captureReason: relevance.reason,
      truncated: snippet.truncated,
      retained: true,
      filtered: false,
    } satisfies CodexAiResponsePayload),
    'bounded_redacted',
    relevance.reason,
    snippet.truncated,
  );
}

function annotateEvent(
  event: CodexNormalizedEvent,
  payloadPatch: Record<string, unknown>,
): CodexNormalizedEvent {
  return {
    ...event,
    payload: compactPayload({
      ...event.payload,
      ...payloadPatch,
    }),
  };
}

function keepDecision(
  event: CodexNormalizedEvent,
  capturePolicy: CodexCapturePolicy,
  captureReason?: CodexCaptureReason,
  truncated = false,
): CodexCaptureDecision {
  return {
    event,
    capturePolicy,
    captureReason,
    truncated,
    retained: true,
    filtered: false,
  };
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function maybeRedactSummary(value: unknown): string | undefined {
  const summary = optionalString(value);
  return summary === undefined ? undefined : redactCodexText(summary);
}
