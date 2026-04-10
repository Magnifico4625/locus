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
