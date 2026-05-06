import { describe, expect, it } from 'vitest';
import type { MemoryRecallCandidate } from '../../src/types.js';
import type { ParsedRecallQuery } from '../../src/recall/query-parser.js';
import { scoreRecallCandidate } from '../../src/recall/scoring.js';

function parsedQuery(overrides: Partial<ParsedRecallQuery> = {}): ParsedRecallQuery {
  return {
    original: 'what did we decide about auth?',
    normalized: 'what did we decide about auth',
    normalizedTerms: ['what', 'did', 'we', 'decide', 'about', 'auth'],
    terms: ['auth'],
    termVariants: ['auth'],
    intent: 'decision',
    topicHints: ['auth_strategy'],
    ...overrides,
  };
}

function candidate(overrides: Partial<MemoryRecallCandidate> = {}): MemoryRecallCandidate {
  return {
    headline: 'Use GitHub OAuth for auth.',
    whyMatched: 'recent conversation context',
    eventIds: ['evt-1'],
    durableMemoryIds: [],
    matchedTerms: ['auth'],
    sourceKind: 'conversation',
    intent: 'decision',
    ...overrides,
  };
}

describe('scoreRecallCandidate', () => {
  const now = Date.parse('2026-05-06T12:00:00.000Z');

  it('scores intent matches higher than mismatches', () => {
    const match = scoreRecallCandidate(candidate({ intent: 'decision' }), parsedQuery(), { now });
    const mismatch = scoreRecallCandidate(candidate({ intent: 'general' }), parsedQuery(), { now });

    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.reasons).toContain('intent_match');
  });

  it('scores exact topic key matches higher', () => {
    const match = scoreRecallCandidate(candidate({ topicKey: 'auth_strategy' }), parsedQuery(), { now });
    const mismatch = scoreRecallCandidate(candidate({ topicKey: 'database_choice' }), parsedQuery(), { now });

    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.reasons).toContain('topic_match');
  });

  it('scores recent candidates higher than old candidates', () => {
    const recent = scoreRecallCandidate(candidate({ timestamp: now - 60_000 }), parsedQuery(), { now });
    const old = scoreRecallCandidate(candidate({ timestamp: now - 45 * 24 * 60 * 60 * 1000 }), parsedQuery(), {
      now,
    });

    expect(recent.score).toBeGreaterThan(old.score);
    expect(recent.reasons).toContain('recent');
  });

  it('prefers durable memories over raw conversation for decision and style questions', () => {
    const durable = scoreRecallCandidate(
      candidate({ sourceKind: 'durable', durableMemoryIds: [1], eventIds: [] }),
      parsedQuery({ intent: 'decision' }),
      { now },
    );
    const conversation = scoreRecallCandidate(
      candidate({ sourceKind: 'conversation', durableMemoryIds: [], eventIds: ['evt-1'] }),
      parsedQuery({ intent: 'decision' }),
      { now },
    );

    expect(durable.score).toBeGreaterThan(conversation.score);
    expect(durable.reasons).toContain('durable_priority');
  });

  it('scores capture reason matches higher', () => {
    const match = scoreRecallCandidate(candidate({ captureReason: 'decision' }), parsedQuery(), { now });
    const mismatch = scoreRecallCandidate(candidate({ captureReason: 'bug_context' }), parsedQuery(), { now });

    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.reasons).toContain('capture_reason_match');
  });
});
