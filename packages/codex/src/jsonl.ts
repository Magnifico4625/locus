import type { CodexJsonlParseResult } from './types.js';

export function parseCodexJsonl(raw: string, filePath: string): CodexJsonlParseResult {
  const records: CodexJsonlParseResult['records'] = [];
  const errors: CodexJsonlParseResult['errors'] = [];
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line?.trim() ?? '';

    if (trimmed.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      errors.push({
        line: lineNumber,
        filePath,
        message: error instanceof Error ? error.message : 'Invalid JSON',
      });
      continue;
    }

    if (!isRecordObject(parsed)) {
      errors.push({
        line: lineNumber,
        filePath,
        message: 'JSONL record must be an object',
      });
      continue;
    }

    records.push({
      line: lineNumber,
      filePath,
      raw: parsed,
    });
  }

  return { records, errors };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
