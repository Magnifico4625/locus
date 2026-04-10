import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCodexJsonl } from '../src/jsonl.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('parseCodexJsonl', () => {
  it('parses valid JSONL records and keeps line numbers', () => {
    const result = parseCodexJsonl(fixture('basic-session.jsonl'), 'basic-session.jsonl');

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(4);
    expect(result.records[0]).toMatchObject({
      line: 1,
      filePath: 'basic-session.jsonl',
      raw: { type: 'session_meta' },
    });
    expect(result.records[3]?.line).toBe(4);
  });

  it('skips empty lines without producing errors', () => {
    const result = parseCodexJsonl('\n{"type":"session_meta"}\r\n  \n', 'inline.jsonl');

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.line).toBe(2);
  });

  it('keeps parsing after malformed JSON lines', () => {
    const result = parseCodexJsonl(fixture('malformed-lines.jsonl'), 'malformed-lines.jsonl');

    expect(result.records).toHaveLength(3);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((error) => error.line)).toEqual([2, 4]);
    expect(result.errors[0]?.filePath).toBe('malformed-lines.jsonl');
  });

  it('reports non-object JSON values as parse errors', () => {
    const result = parseCodexJsonl('42\n["array"]\nnull\n{"type":"session_meta"}', 'values.jsonl');

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.line).toBe(4);
    expect(result.errors.map((error) => error.line)).toEqual([1, 2, 3]);
  });

  it('does not reject unknown record schemas at parser level', () => {
    const result = parseCodexJsonl(fixture('unknown-records.jsonl'), 'unknown-records.jsonl');

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(3);
    expect(result.records.map((record) => record.raw.type)).toEqual([
      'unknown_future_type',
      'event_msg',
      'response_item',
    ]);
  });
});
