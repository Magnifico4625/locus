import { describe, expect, it } from 'vitest';
import type { DurableMemoryCandidate } from '../../src/memory/durable-extractor.js';
import { extractDurableCandidatesFromEvent } from '../../src/memory/durable-extractor.js';
import type { ConversationEventRow, DurableMemoryType } from '../../src/types.js';
import { DURABLE_MEMORY_TYPES } from '../../src/types.js';

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
  it('exposes Track C durable memory types as a runtime contract', () => {
    expect(DURABLE_MEMORY_TYPES).toEqual([
      'decision',
      'preference',
      'style',
      'constraint',
      'rejected_alternative',
      'next_step',
      'validation_fact',
    ]);
  });

  it('allows Track C durable memory candidate types at the type boundary', () => {
    const memoryTypes: DurableMemoryType[] = [
      'rejected_alternative',
      'next_step',
      'validation_fact',
    ];

    const candidates = memoryTypes.map(
      (memoryType): DurableMemoryCandidate => ({
        memoryType,
        summary: `Track C candidate: ${memoryType}`,
        evidence: { source: 'test' },
        source: 'codex',
      }),
    );

    expect(candidates.map((candidate) => candidate.memoryType)).toEqual(memoryTypes);
  });

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
        evidence: expect.objectContaining({
          matchedPattern: expect.any(String),
          confidence: expect.any(Number),
          reason: expect.any(String),
        }),
        source: 'codex',
        sourceEventId: 'evt-database',
      }),
    ]);
  });

  it('extracts accepted RU decisions with canonical English topic keys', () => {
    const event = makeConversationRow({
      event_id: 'evt-ru-decision',
      payload_json: JSON.stringify({
        prompt: 'Мы решили использовать PostgreSQL для долговременной памяти.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'decision',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'database_choice',
        memoryType: 'decision',
        sourceEventId: 'evt-ru-decision',
      }),
    ]);
  });

  it('does not extract recall questions as durable decisions', () => {
    const event = makeConversationRow({
      event_id: 'evt-question',
      payload_json: JSON.stringify({
        prompt: 'Что решили по capture strategy?',
        capture_policy: 'bounded_redacted',
        capture_reason: 'decision',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([]);
  });

  it('extracts rejected alternatives with rationale', () => {
    const event = makeConversationRow({
      event_id: 'evt-rejected',
      payload_json: JSON.stringify({
        prompt: 'Rejected hook-first capture because it is too risky for the stable release.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'rejected_alternative',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'codex_hooks_strategy',
        memoryType: 'rejected_alternative',
        summary: 'Rejected hook-first capture because it is too risky for the stable release.',
        evidence: expect.objectContaining({
          matchedPattern: expect.any(String),
          confidence: expect.any(Number),
          reason: 'rejected_alternative_with_rationale',
        }),
      }),
    ]);
  });

  it('extracts user workflow preferences', () => {
    const event = makeConversationRow({
      event_id: 'evt-preference',
      payload_json: JSON.stringify({
        prompt: 'I prefer one task at a time with approval gates.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'preference',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'user_workflow_style',
        memoryType: 'preference',
        sourceEventId: 'evt-preference',
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

  it('extracts Russian workflow style from bounded redacted prompts', () => {
    const event = makeConversationRow({
      event_id: 'evt-ru-style',
      payload_json: JSON.stringify({
        prompt:
          'Мой стиль работы: короткие отчеты после каждого атомарного таска, git commit на чекпоинтах, не переходить к следующей задаче без одобрения.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'preference',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        topicKey: 'user_workflow_style',
        memoryType: 'style',
        sourceEventId: 'evt-ru-style',
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

  it('extracts next steps from assistant summaries', () => {
    const event = makeConversationRow({
      event_id: 'evt-next-step',
      kind: 'ai_response',
      payload_json: JSON.stringify({
        response: 'Next step: update the README install section after the package smoke test.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'next_step',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        memoryType: 'next_step',
        sourceEventId: 'evt-next-step',
        evidence: expect.objectContaining({
          reason: 'next_step',
          confidence: expect.any(Number),
        }),
      }),
    ]);
  });

  it('extracts validation facts with command context', () => {
    const event = makeConversationRow({
      event_id: 'evt-validation',
      kind: 'ai_response',
      payload_json: JSON.stringify({
        response:
          'Validation passed: npm test -- packages/core/tests/memory/durable-extractor.test.ts and npm -w @locus/core run typecheck.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'validation_fact',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([
      expect.objectContaining({
        memoryType: 'validation_fact',
        summary: expect.stringContaining('npm test -- packages/core/tests/memory'),
        sourceEventId: 'evt-validation',
        evidence: expect.objectContaining({
          reason: 'validation_fact',
          matchedPattern: expect.any(String),
        }),
      }),
    ]);
  });

  it('drops low-confidence vague statements', () => {
    const event = makeConversationRow({
      event_id: 'evt-vague',
      payload_json: JSON.stringify({
        prompt: 'Maybe we discussed something useful around this area.',
        capture_policy: 'bounded_redacted',
        capture_reason: 'general_context',
      }),
    });

    expect(extractDurableCandidatesFromEvent(event)).toEqual([]);
  });
});
