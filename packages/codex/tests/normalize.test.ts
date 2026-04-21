import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCodexJsonl } from '../src/jsonl.js';
import { normalizeCodexRecords } from '../src/normalize.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

function recordsFromFixture(name: string) {
  const raw = readFileSync(join(fixturesDir, name), 'utf-8');
  return parseCodexJsonl(raw, name).records;
}

describe('normalizeCodexRecords', () => {
  it('normalizes a basic session and inherits session context', () => {
    const result = normalizeCodexRecords(recordsFromFixture('basic-session.jsonl'));

    expect(result.skipped).toBe(0);
    expect(result.events.map((event) => event.kind)).toEqual([
      'session_start',
      'user_prompt',
      'ai_response',
      'session_end',
    ]);
    expect(result.events.map((event) => event.sessionId)).toEqual([
      'sess_basic_001',
      'sess_basic_001',
      'sess_basic_001',
      'sess_basic_001',
    ]);
    expect(result.events.map((event) => event.projectRoot)).toEqual([
      'C:\\Projects\\SampleApp',
      'C:\\Projects\\SampleApp',
      'C:\\Projects\\SampleApp',
      'C:\\Projects\\SampleApp',
    ]);
    expect(result.events[0]).toMatchObject({
      kind: 'session_start',
      timestamp: Date.parse('2026-04-10T08:00:00.000Z'),
      sourceFile: 'basic-session.jsonl',
      sourceLine: 1,
      payload: { tool: 'codex', model: 'gpt-5.4' },
    });
    expect(result.events[1]?.payload).toEqual({ prompt: 'Create a simple parser test.' });
    expect(result.events[2]?.payload).toEqual({
      response: 'I will add a parser test.',
      model: 'gpt-5.4',
    });
    expect(result.events[3]?.payload).toEqual({ summary: 'Parser test task completed.' });
  });

  it('normalizes Codex tool calls, command completion, and tool output as tool_use events', () => {
    const result = normalizeCodexRecords(recordsFromFixture('tool-session.jsonl'));

    expect(result.skipped).toBe(0);
    expect(result.events.map((event) => event.kind)).toEqual([
      'session_start',
      'tool_use',
      'tool_use',
      'tool_use',
    ]);
    expect(result.events.slice(1).map((event) => event.itemId)).toEqual([
      'call_001',
      'call_001',
      'call_001',
    ]);
    expect(result.events[1]?.payload).toEqual({
      tool: 'shell_command',
      callId: 'call_001',
      arguments: '{"command":"npm test"}',
    });
    expect(result.events[2]?.payload).toEqual({
      tool: 'exec_command_end',
      callId: 'call_001',
      exitCode: 0,
      durationMs: 1200,
      status: 'success',
    });
    expect(result.events[3]?.payload).toEqual({
      tool: 'function_call_output',
      callId: 'call_001',
      output: 'Exit code: 0\nWall time: 1.2s',
    });
  });

  it('skips unknown records without dropping known records parsed from the same file', () => {
    const malformed = normalizeCodexRecords(recordsFromFixture('malformed-lines.jsonl'));
    const unknown = normalizeCodexRecords(recordsFromFixture('unknown-records.jsonl'));

    expect(malformed.skipped).toBe(0);
    expect(malformed.events.map((event) => event.kind)).toEqual([
      'session_start',
      'user_prompt',
      'session_end',
    ]);
    expect(unknown.events).toHaveLength(0);
    expect(unknown.skipped).toBe(3);
  });

  it('uses safe fallbacks for records without session metadata', () => {
    const result = normalizeCodexRecords([
      {
        filePath: 'inline.jsonl',
        line: 7,
        raw: {
          type: 'event_msg',
          subtype: 'user_message',
          timestamp: 'not-a-date',
          message: 'No session metadata yet.',
        },
      },
    ]);

    expect(result.skipped).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kind: 'user_prompt',
      sessionId: 'unknown-session',
      projectRoot: process.cwd(),
      sourceFile: 'inline.jsonl',
      sourceLine: 7,
      payload: { prompt: 'No session metadata yet.' },
    });
    expect(Number.isFinite(result.events[0]?.timestamp)).toBe(true);
  });

  it('preserves full assistant text so bounded capture can reduce it later', () => {
    const result = normalizeCodexRecords([
      {
        filePath: 'inline.jsonl',
        line: 1,
        raw: {
          type: 'session_meta',
          timestamp: '2026-04-10T12:00:00.000Z',
          session_id: 'sess_inline_001',
          cwd: 'C:\\Projects\\InlineApp',
          model: 'gpt-5.4',
        },
      },
      {
        filePath: 'inline.jsonl',
        line: 2,
        raw: {
          type: 'response_item',
          timestamp: '2026-04-10T12:00:01.000Z',
          item: {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'I traced the parser failure to the nullable branch.' },
              { type: 'output_text', text: 'Next I will add the failing regression test.' },
            ],
          },
        },
      },
    ]);

    expect(result.skipped).toBe(0);
    expect(result.events[1]).toMatchObject({
      kind: 'ai_response',
      sessionId: 'sess_inline_001',
      projectRoot: 'C:\\Projects\\InlineApp',
      payload: {
        response:
          'I traced the parser failure to the nullable branch.\nNext I will add the failing regression test.',
        model: 'gpt-5.4',
      },
    });
  });
});
