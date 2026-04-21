export interface CodexJsonlRecord {
  line: number;
  filePath: string;
  raw: Record<string, unknown>;
}

export interface CodexJsonlParseError {
  line: number;
  filePath: string;
  message: string;
}

export interface CodexJsonlParseResult {
  records: CodexJsonlRecord[];
  errors: CodexJsonlParseError[];
}

export type CodexNormalizedKind =
  | 'user_prompt'
  | 'ai_response'
  | 'tool_use'
  | 'session_start'
  | 'session_end';

export type CodexCaptureReason =
  | 'noise'
  | 'bug_context'
  | 'decision'
  | 'preference'
  | 'next_step'
  | 'general_context';

export type CodexCapturePolicy = 'off' | 'metadata' | 'bounded_redacted' | 'full';

export interface CodexCaptureAnnotations {
  capturePolicy?: Exclude<CodexCapturePolicy, 'off'>;
  captureReason?: CodexCaptureReason;
  truncated?: boolean;
  retained?: boolean;
  filtered?: boolean;
}

export interface CodexUserPromptPayload extends CodexCaptureAnnotations {
  prompt: string;
}

export interface CodexAiResponsePayload extends CodexCaptureAnnotations {
  response: string;
  model?: string;
}

export interface CodexSessionEndPayload extends CodexCaptureAnnotations {
  summary?: string;
}

export interface CodexNormalizedEvent {
  kind: CodexNormalizedKind;
  timestamp: number;
  sessionId: string;
  projectRoot: string;
  sourceFile: string;
  sourceLine: number;
  itemId?: string;
  payload: Record<string, unknown>;
}

export interface CodexNormalizeResult {
  events: CodexNormalizedEvent[];
  skipped: number;
}

export type CodexCaptureMode = 'off' | 'metadata' | 'redacted' | 'full';

export interface CodexCaptureDecision {
  event: CodexNormalizedEvent | null;
  capturePolicy: CodexCapturePolicy;
  captureReason?: CodexCaptureReason;
  truncated: boolean;
  retained: boolean;
  filtered: boolean;
}

export interface CodexImportOptions {
  inboxDir: string;
  sessionsDir?: string;
  captureMode?: CodexCaptureMode;
  latestOnly?: boolean;
  projectRoot?: string;
  sessionId?: string;
  since?: number;
  shouldSkipEventId?: (eventId: string) => boolean;
  env?: Record<string, string | undefined>;
}

export interface CodexImportMetrics {
  filesScanned: number;
  recordsParsed: number;
  parseErrors: number;
  normalized: number;
  written: number;
  duplicatePending: number;
  skippedUnknown: number;
  skippedByCapture: number;
  skippedByFilter: number;
  errors: number;
  latestSession?: string;
}
