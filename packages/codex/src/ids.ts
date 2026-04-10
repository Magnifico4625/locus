import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export interface CodexSourceEventIdInput {
  sessionId?: string;
  filePath: string;
  line: number;
  kind: string;
  itemId?: string;
}

export function createCodexSourceEventId(input: CodexSourceEventIdInput): string {
  const sessionId = input.sessionId ?? 'unknown-session';
  const fileName = basename(input.filePath);
  const itemId = input.itemId ?? 'no-item';

  return `codex:${sessionId}:${fileName}:${input.line}:${input.kind}:${itemId}`;
}

export function createCodexEventId(sourceEventId: string): string {
  return createHash('sha256').update(sourceEventId).digest('hex');
}
