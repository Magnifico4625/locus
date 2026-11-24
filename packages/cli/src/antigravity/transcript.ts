import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type CaptureLevel, type InboxEvent, isNoisyPrompt, redact } from '@locus/core';

export const ANTIGRAVITY_TRANSCRIPT_CURSOR_PREFIX = 'antigravity.transcript.';

export interface ParseAntigravityTranscriptOptions {
  transcriptPath: string;
  conversationId: string;
  projectRoot: string;
  captureLevel: CaptureLevel;
  afterStepIndex?: number;
  now?: number;
}

export interface ParseAntigravityTranscriptResult {
  events: InboxEvent[];
  maxStepIndex: number;
}

const REDACTED_MAX_CHARS = 600;
const FULL_MAX_CHARS = 4000;
const USER_REQUEST_BLOCK_RE = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/gi;
const SYSTEM_ENVELOPE_BLOCK_RE =
  /<(?:ADDITIONAL_METADATA|SYSTEM_MESSAGE|CONTEXT_SUMMARY)>[\s\S]*?<\/(?:ADDITIONAL_METADATA|SYSTEM_MESSAGE|CONTEXT_SUMMARY)>/gi;
const SYSTEM_MESSAGE_BLOCK_RE = /<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi;
const HOOK_ECHO_PATTERNS: readonly RegExp[] = [
  /The following system message was injected by a (?:PreInvocation|SessionStart|UserPromptSubmit) hook:[\s\S]*/gi,
  /\[Locus Memory — (?:Project Brief|Relevant Recall)\][\s\S]*/gi,
];

export function stripAntigravityHookEchoes(text: string): string {
  let cleaned = text;
  for (const pattern of HOOK_ECHO_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.trim();
}

export function cleanAntigravityUserInput(raw: string): string {
  const extracted = [...raw.matchAll(USER_REQUEST_BLOCK_RE)]
    .map((match) => stripAntigravityHookEchoes((match[1] ?? '').trim()))
    .filter((segment) => segment.length > 0);

  if (extracted.length > 0) {
    return extracted.join('\n').trim();
  }

  return stripAntigravityHookEchoes(
    raw.replace(SYSTEM_ENVELOPE_BLOCK_RE, ' ').replace(/<\/?USER_REQUEST>/gi, ' '),
  );
}

export function antigravityTranscriptCursorKey(conversationId: string): string {
  return `${ANTIGRAVITY_TRANSCRIPT_CURSOR_PREFIX}${conversationId}.last_step_index`;
}

function deterministicEventId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function resolveRecordTimestamp(record: Record<string, unknown>, fallbackNow: number): number {
  if (typeof record.created_at === 'string') {
    const parsed = Date.parse(record.created_at);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallbackNow;
}

export function parseAntigravityTranscriptEvents(
  options: ParseAntigravityTranscriptOptions,
): ParseAntigravityTranscriptResult {
  const afterStepIndex = options.afterStepIndex ?? -1;
  let maxStepIndex = afterStepIndex;

  let raw: string;
  try {
    raw = readFileSync(options.transcriptPath, 'utf8');
  } catch {
    return { events: [], maxStepIndex };
  }

  const events: InboxEvent[] = [];
  const fallbackNow = options.now ?? Date.now();
  const maxChars = options.captureLevel === 'full' ? FULL_MAX_CHARS : REDACTED_MAX_CHARS;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const stepIndex = record.step_index;
    if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex) || stepIndex < 0) {
      continue;
    }

    if (stepIndex > maxStepIndex) {
      maxStepIndex = stepIndex;
    }

    if (stepIndex <= afterStepIndex || options.captureLevel === 'metadata') {
      continue;
    }

    if (typeof record.content !== 'string' || record.content.trim().length === 0) {
      continue;
    }

    const timestamp = resolveRecordTimestamp(record, fallbackNow);
    const sourceEventId = `antigravity:${options.conversationId}:step:${stepIndex}`;

    if (
      record.type === 'USER_INPUT' &&
      record.source === 'USER_EXPLICIT' &&
      record.status === 'DONE'
    ) {
      const cleaned = cleanAntigravityUserInput(record.content);
      if (!cleaned || isNoisyPrompt(cleaned)) {
        continue;
      }

      const sanitized = truncateText(redact(cleaned).trim(), maxChars).trim();
      if (!sanitized) {
        continue;
      }

      const payload: Record<string, unknown> = { prompt: sanitized };
      if (options.captureLevel === 'redacted') {
        payload.capture_policy = 'bounded_redacted';
      }

      events.push({
        version: 1,
        event_id: deterministicEventId(`${sourceEventId}:user_prompt`),
        source: 'antigravity',
        source_event_id: sourceEventId,
        project_root: options.projectRoot,
        session_id: options.conversationId,
        timestamp,
        kind: 'user_prompt',
        payload,
      });
      continue;
    }

    if (
      record.type === 'PLANNER_RESPONSE' &&
      record.source === 'MODEL' &&
      record.status === 'DONE'
    ) {
      // Intentionally ignore `thinking` and strip any injected system wrappers before redacting.
      const cleaned = stripAntigravityHookEchoes(
        record.content.replace(SYSTEM_MESSAGE_BLOCK_RE, ' '),
      );
      if (!cleaned) {
        continue;
      }

      const sanitized = truncateText(redact(cleaned).trim(), maxChars).trim();
      if (!sanitized) {
        continue;
      }

      const payload: Record<string, unknown> = { response: sanitized };
      if (typeof record.model === 'string' && record.model.trim().length > 0) {
        payload.model = record.model.trim();
      }
      if (options.captureLevel === 'redacted') {
        payload.capture_policy = 'bounded_redacted';
      }

      events.push({
        version: 1,
        event_id: deterministicEventId(`${sourceEventId}:ai_response`),
        source: 'antigravity',
        source_event_id: sourceEventId,
        project_root: options.projectRoot,
        session_id: options.conversationId,
        timestamp,
        kind: 'ai_response',
        payload,
      });
    }
  }

  return { events, maxStepIndex };
}
