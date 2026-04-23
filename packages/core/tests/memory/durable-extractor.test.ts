import { describe, expect, it } from 'vitest';
import { extractDurableCandidatesFromEvent } from '../../src/memory/durable-extractor.js';
import type { ConversationEventRow } from '../../src/types.js';

function makeConversationRow(
  overrides: Partial<ConversationEventRow> & { payload_json: string },
): ConversationEventRow {
  return {
    id: 1,
    event_id: 'evt-1',
    source: 'codex',
    source_event_id: 'codex:evt-1',
    project_root: 'C:/Projects/Locus',
    session_id: 'sess-1',
    timestamp: Date.parse('2026-04-22T08:00:00.000Z'),
    kind: 'user_prompt',
    payload_json: overrides.payload_json,
    significance: 'high',
    tags_json: '[]',
    created_at: Date.parse('2026-04-22T08:00:00.000Z'),
    ...overrides,
  };
}

describe('extractDurableCandidatesFromEvent', () => {
  it('extracts a database choice durable fact from conversation payloads', () => {
    const event = makeConversationRow({
      event_id: 'evt-database',
      kind: 'session_end',
      payload_json: JSON.stringify({
        summary: 'Decision: use SQLite for the local durable memory store.',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'database_choice',
        memoryType: 'decision',
        source: 'codex',
        sourceEventId: 'evt-database',
      }),
    ]);
  });

  it('extracts a coding-style preference from bounded redacted prompts', () => {
    const event = makeConversationRow({
      event_id: 'evt-style',
      payload_json: JSON.stringify({
        prompt: 'Keep the fix surgical, avoid unrelated refactors, and prove it with tests.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'preference',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        memoryType: 'style',
        sourceEventId: 'evt-style',
        source: 'codex',
      }),
    ]);
  });

  it('extracts stable constraints from explicit project constraints', () => {
    const event = makeConversationRow({
      event_id: 'evt-constraint',
      kind: 'user_prompt',
      payload_json: JSON.stringify({
        prompt: 'Do not touch packages/claude-code and keep Codex as the primary validation path.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'preference',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        memoryType: 'constraint',
        sourceEventId: 'evt-constraint',
        source: 'codex',
      }),
    ]);
  });

  it('extracts an auth strategy durable decision when the payload names a stable approach', () => {
    const event = makeConversationRow({
      event_id: 'evt-auth',
      kind: 'ai_response',
      payload_json: JSON.stringify({
        response: 'Decision: use GitHub OAuth as the auth strategy for the dashboard login flow.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'decision',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'auth_strategy',
        memoryType: 'decision',
        sourceEventId: 'evt-auth',
      }),
    ]);
  });
});
