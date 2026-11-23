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

  it('normalizes current Codex payload-wrapped JSONL records', () => {
    const result = normalizeCodexRecords([
      {
        filePath: 'rollout-2026-04-23.jsonl',
        line: 1,
        raw: {
          type: 'session_meta',
          timestamp: '2026-04-23T05:54:17.000Z',
          session_id: '019db8e7-45db-7012-b6dc-a1f8ff438f5d',
          cwd: 'C:\\Users\\Admin\\gemini-project\\ClaudeMagnificoMem',
          model: 'gpt-5.4',
        },
      },
      {
        filePath: 'rollout-2026-04-23.jsonl',
        line: 74,
        raw: {
          type: 'response_item',
          timestamp: '2026-04-23T05:57:57.702Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Тестовая фраза в текущем чате: TRACKA-LIVE-20260423.',
              },
            ],
          },
        },
      },
      {
        filePath: 'rollout-2026-04-23.jsonl',
        line: 75,
        raw: {
          type: 'event_msg',
          timestamp: '2026-04-23T05:57:57.702Z',
          payload: {
            type: 'user_message',
            message:
              'Тестовая фраза в текущем чате: TRACKA-LIVE-20260423.\n\nРешение для live recall теста: выбираем SQLite cache и redacted capture.',
            images: [],
            local_images: [],
            text_elements: [],
          },
        },
      },
      {
        filePath: 'rollout-2026-04-23.jsonl',
        line: 80,
        raw: {
          type: 'response_item',
          timestamp: '2026-04-23T05:58:01.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Для live recall теста зафиксировал выбор SQLite cache и redacted capture.',
              },
            ],
          },
        },
      },
      {
        filePath: 'rollout-2026-04-23.jsonl',
        line: 110,
        raw: {
          type: 'event_msg',
          timestamp: '2026-04-23T05:59:00.000Z',
          payload: {
            type: 'task_complete',
            last_agent_message: 'Live recall test showed no imported user prompt before the fix.',
          },
        },
      },
    ]);

    expect(result.skipped).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual([
      'session_start',
      'user_prompt',
      'ai_response',
      'session_end',
    ]);
    expect(result.events[1]).toMatchObject({
      kind: 'user_prompt',
      sessionId: '019db8e7-45db-7012-b6dc-a1f8ff438f5d',
      projectRoot: 'C:\\Users\\Admin\\gemini-project\\ClaudeMagnificoMem',
      payload: {
        prompt:
          'Тестовая фраза в текущем чате: TRACKA-LIVE-20260423.\n\nРешение для live recall теста: выбираем SQLite cache и redacted capture.',
      },
    });
    expect(result.events[2]?.payload).toEqual({
      response: 'Для live recall теста зафиксировал выбор SQLite cache и redacted capture.',
      model: 'gpt-5.4',
    });
    expect(result.events[3]?.payload).toEqual({
      summary: 'Live recall test showed no imported user prompt before the fix.',
    });
  });

  it('normalizes nested session_meta.payload and turn_context.payload from real Codex Desktop rollouts', () => {
    const result = normalizeCodexRecords([
      {
        filePath: 'rollout-desktop.jsonl',
        line: 1,
        raw: {
          type: 'session_meta',
          timestamp: '2026-11-23T12:00:00.000Z',
          payload: {
            id: '019fb276-fallback-id',
            session_id: '019fb276-f410-74e3-947b-d8ba6d1abb5d',
            cwd: 'C:\\Users\\Admin\\gemini-project\\APPS\\GasworkersSite',
          },
        },
      },
      {
        filePath: 'rollout-desktop.jsonl',
        line: 2,
        raw: {
          type: 'turn_context',
          timestamp: '2026-11-23T12:00:01.000Z',
          payload: {
            cwd: 'C:\\Users\\Admin\\gemini-project\\APPS\\GasworkersSite\\subdir',
            model: 'gpt-5.6-codex',
          },
        },
      },
      {
        filePath: 'rollout-desktop.jsonl',
        line: 3,
        raw: {
          type: 'response_item',
          timestamp: '2026-11-23T12:00:02.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Decision: keep shared rollout ingestion synchronized across workspaces.',
              },
            ],
          },
        },
      },
      {
        filePath: 'rollout-desktop.jsonl',
        line: 4,
        raw: {
          type: 'event_msg',
          timestamp: '2026-11-23T12:00:03.000Z',
          payload: {
            type: 'task_complete',
            last_agent_message: 'Wrapped up Codex Desktop nested payload support.',
          },
        },
      },
    ]);

    expect(result.skipped).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual([
      'session_start',
      'ai_response',
      'session_end',
    ]);
    expect(result.events[0]).toMatchObject({
      kind: 'session_start',
      sessionId: '019fb276-f410-74e3-947b-d8ba6d1abb5d',
      projectRoot: 'C:\\Users\\Admin\\gemini-project\\APPS\\GasworkersSite',
    });
    expect(result.events[1]).toMatchObject({
      kind: 'ai_response',
      sessionId: '019fb276-f410-74e3-947b-d8ba6d1abb5d',
      projectRoot: 'C:\\Users\\Admin\\gemini-project\\APPS\\GasworkersSite\\subdir',
      payload: {
        response: 'Decision: keep shared rollout ingestion synchronized across workspaces.',
        model: 'gpt-5.6-codex',
      },
    });
    expect(result.events[2]).toMatchObject({
      kind: 'session_end',
      sessionId: '019fb276-f410-74e3-947b-d8ba6d1abb5d',
      payload: {
        summary: 'Wrapped up Codex Desktop nested payload support.',
      },
    });
  });

  it('normalizes Codex 0.171 item_completed UserMessage/CommandExecution and custom_tool_call records', () => {
    const result = normalizeCodexRecords([
      {
        filePath: 'rollout-0171.jsonl',
        line: 1,
        raw: {
          type: 'session_meta',
          timestamp: '2026-11-23T13:30:59.000Z',
          payload: {
            id: '01a207f5-7e09-7131-95b1-dfb05a8e3d63',
            session_id: '01a207f5-7e09-7131-95b1-dfb05a8e3d63',
            cwd: 'C:\\Projects\\Codex171',
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 2,
        raw: {
          type: 'event_msg',
          timestamp: '2026-11-23T13:31:00.000Z',
          payload: {
            type: 'item_completed',
            item: {
              type: 'UserMessage',
              id: 'user-msg-1',
              content: [
                {
                  type: 'text',
                  text: 'Decision: CODEX-LIVE-V4 используем NATS JetStream для очереди задач.',
                },
              ],
            },
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 3,
        raw: {
          type: 'event_msg',
          timestamp: '2026-11-23T13:31:01.000Z',
          payload: {
            type: 'item_completed',
            item: {
              type: 'AgentMessage',
              id: 'agent-msg-1',
              content: [{ type: 'Text', text: 'Duplicate agent event should be ignored.' }],
            },
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 4,
        raw: {
          type: 'response_item',
          timestamp: '2026-11-23T13:31:02.000Z',
          payload: {
            type: 'custom_tool_call',
            call_id: 'call_exec_1',
            name: 'exec',
            input: 'Write-Output LOCUS-POST-TOOL-PROBE',
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 5,
        raw: {
          type: 'event_msg',
          timestamp: '2026-11-23T13:31:03.000Z',
          payload: {
            type: 'item_completed',
            item: {
              type: 'CommandExecution',
              id: 'exec-cmd-1',
              status: 'failed',
              exit_code: -1,
              duration: { secs: 1, nanos: 250000000 },
            },
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 6,
        raw: {
          type: 'response_item',
          timestamp: '2026-11-23T13:31:04.000Z',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_exec_1',
            output: [{ type: 'input_text', text: 'Script failed' }],
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 7,
        raw: {
          type: 'response_item',
          timestamp: '2026-11-23T13:31:04.500Z',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_exec_2',
            output: [{ type: 'input_text', text: 'Script completed\nOutput:\nOK' }],
          },
        },
      },
      {
        filePath: 'rollout-0171.jsonl',
        line: 8,
        raw: {
          type: 'response_item',
          timestamp: '2026-11-23T13:31:05.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Подтверждаю: в CODEX-LIVE-V4 используем NATS JetStream для очереди задач.',
              },
            ],
          },
        },
      },
    ]);

    expect(result.skipped).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual([
      'session_start',
      'user_prompt',
      'tool_use',
      'tool_use',
      'tool_use',
      'tool_use',
      'ai_response',
    ]);
    expect(result.events[1]).toMatchObject({
      kind: 'user_prompt',
      itemId: 'user-msg-1',
      payload: {
        prompt: 'Decision: CODEX-LIVE-V4 используем NATS JetStream для очереди задач.',
      },
    });
    expect(result.events[2]?.payload).toEqual({
      tool: 'exec',
      callId: 'call_exec_1',
      arguments: 'Write-Output LOCUS-POST-TOOL-PROBE',
    });
    expect(result.events[3]?.payload).toEqual({
      tool: 'CommandExecution',
      exitCode: -1,
      durationMs: 1250,
      status: 'error',
    });
    expect(result.events[4]?.payload).toEqual({
      tool: 'custom_tool_call_output',
      callId: 'call_exec_1',
      output: 'Script failed',
      status: 'error',
    });
    expect(result.events[5]?.payload).toEqual({
      tool: 'custom_tool_call_output',
      callId: 'call_exec_2',
      output: 'Script completed\nOutput:\nOK',
      status: 'success',
    });
    expect(result.events[6]?.payload).toEqual({
      response: 'Подтверждаю: в CODEX-LIVE-V4 используем NATS JetStream для очереди задач.',
    });
  });
});
