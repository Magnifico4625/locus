import type { CodexCaptureMode, CodexNormalizedKind } from './types.js';

const VALID_CAPTURE_MODES = new Set<CodexCaptureMode>(['off', 'metadata', 'redacted', 'full']);

export function getCodexCaptureMode(
  env: Record<string, string | undefined> = process.env,
): CodexCaptureMode {
  const value = env.LOCUS_CODEX_CAPTURE;
  return isCodexCaptureMode(value) ? value : 'metadata';
}

export function shouldImportCodexEvent(
  mode: CodexCaptureMode,
  kind: CodexNormalizedKind,
): boolean {
  if (mode === 'off') {
    return false;
  }

  if (mode === 'metadata') {
    return kind !== 'user_prompt' && kind !== 'ai_response';
  }

  if (mode === 'redacted') {
    return kind !== 'ai_response';
  }

  return true;
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
