import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateInboxEvent } from '../../core/src/ingest/schema.js';
import { toInboxEvent } from '../src/inbox-event.js';
import { parseCodexJsonl } from '../src/jsonl.js';
import { normalizeCodexRecords } from '../src/normalize.js';
import type { CodexNormalizedEvent } from '../src/types.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

function normalizedFromFixture(name: string): CodexNormalizedEvent[] {
  const raw = readFileSync(join(fixturesDir, name), 'utf-8');
  const parsed = parseCodexJsonl(raw, name);
  return normalizeCodexRecords(parsed.records).events;
}

describe('toInboxEvent', () => {
  it('maps normalized basic session events to valid InboxEvent v1 records', () => {
    const events = normalizedFromFixture('basic-session.jsonl');
    const inboxEvents = events.map((event) => toInboxEvent(event, 'full'));

    expect(inboxEvents).toHaveLength(4);
    for (const event of inboxEvents) {
      expect(event).not.toBeNull();
      expect(validateInboxEvent(event)).toEqual(event);
      expect(event).toMatchObject({
        version: 1,
        source: 'codex',
        project_root: 'C:\\Projects\\SampleApp',
        session_id: 'sess_basic_001',
      });
    }

    expect(inboxEvents.map((event) => event?.kind)).toEqual([
      'session_start',
      'user_prompt',
      'ai_response',
      'session_end',
    ]);
    expect(inboxEvents[0]?.payload).toEqual({ tool: 'codex', model: 'gpt-5.4' });
    expect(inboxEvents[1]?.payload).toEqual({ prompt: 'Create a simple parser test.' });
    expect(inboxEvents[2]?.payload).toEqual({
      response: 'I will add a parser test.',
      model: 'gpt-5.4',
    });
    expect(inboxEvents[3]?.payload).toEqual({ summary: 'Parser test task completed.' });
  });

  it('creates deterministic event ids from stable source_event_id', () => {
    const [event] = normalizedFromFixture('basic-session.jsonl');
    expect(event).toBeDefined();
    if (!event) {
      throw new Error('Expected basic fixture to produce at least one normalized event');
    }
    const inboxEvent = toInboxEvent(event, 'full');
    expect(inboxEvent).not.toBeNull();
    if (!inboxEvent) {
      throw new Error('Expected full capture to produce an inbox event');
    }

    expect(inboxEvent.source_event_id).toBe(
      'codex:sess_basic_001:basic-session.jsonl:1:session_start:no-item',
    );
    expect(inboxEvent.event_id).toBe(
      createHash('sha256').update(inboxEvent.source_event_id).digest('hex'),
    );
  });

  it('maps tool events with InboxEvent tool_use payload shape', () => {
    const events = normalizedFromFixture('tool-session.jsonl');
    const inboxEvents = events.map((event) => toInboxEvent(event, 'full'));

    expect(inboxEvents.map((event) => event?.kind)).toEqual([
      'session_start',
      'tool_use',
      'tool_use',
      'tool_use',
    ]);
    expect(inboxEvents[1]?.payload).toEqual({
      tool: 'shell_command',
      files: [],
      status: 'success',
    });
    expect(inboxEvents[2]?.payload).toEqual({
      tool: 'exec_command_end',
      files: [],
      status: 'success',
      exitCode: 0,
    });
    expect(inboxEvents[3]?.payload).toEqual({
      tool: 'function_call_output',
      files: [],
      status: 'success',
    });
    expect(inboxEvents.every((event) => validateInboxEvent(event) !== null)).toBe(true);
  });

  it('does not produce prompt or assistant InboxEvents in metadata mode', () => {
    const events = normalizedFromFixture('basic-session.jsonl');

    expect(events.map((event) => toInboxEvent(event, 'metadata')?.kind ?? null)).toEqual([
      'session_start',
      null,
      null,
      'session_end',
    ]);
  });

  it('redacts prompt text and skips assistant response in redacted mode', () => {
    const prompt: CodexNormalizedEvent = {
      kind: 'user_prompt',
      timestamp: Date.parse('2026-04-10T12:00:00.000Z'),
      sessionId: 'sess_redacted_001',
      projectRoot: 'C:\\Projects\\SampleApp',
      sourceFile: 'inline.jsonl',
      sourceLine: 2,
      payload: {
        prompt:
          'Use Authorization: Bearer safeexampletoken123 and OPENAI_API_KEY=sk-safeexample1234567890',
      },
    };
    const assistant: CodexNormalizedEvent = {
      ...prompt,
      kind: 'ai_response',
      sourceLine: 3,
      payload: {
        response: 'Assistant response should not be imported in redacted mode.',
        model: 'gpt-5.4',
      },
    };

    expect(toInboxEvent(prompt, 'redacted')?.payload).toEqual({
      prompt: 'Use Authorization: Bearer [REDACTED] and OPENAI_API_KEY=[REDACTED]',
    });
    expect(toInboxEvent(assistant, 'redacted')).toBeNull();
  });
});
