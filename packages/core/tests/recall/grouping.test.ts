import { describe, expect, it } from 'vitest';
import type { MemoryRecallCandidate } from '../../src/types.js';
import { groupRecallCandidates } from '../../src/recall/grouping.js';
import { buildRecallResult } from '../../src/recall/result-builder.js';

function candidate(overrides: Partial<MemoryRecallCandidate> = {}): MemoryRecallCandidate {
  return {
    headline: 'Implemented auth login fixes.',
    whyMatched: 'recent conversation context',
    eventIds: ['evt-1'],
    durableMemoryIds: [],
    sourceKind: 'conversation',
    matchedTerms: ['auth'],
    score: 10,
    confidence: 'high',
    ...overrides,
  };
}

describe('groupRecallCandidates', () => {
  it('creates separate groups for multiple sessions', () => {
    const groups = groupRecallCandidates([
      candidate({ sessionId: 'sess-auth', eventIds: ['evt-auth'], headline: 'Implemented auth login fixes.' }),
      candidate({ sessionId: 'sess-billing', eventIds: ['evt-billing'], headline: 'Implemented billing retry fixes.' }),
    ]);

    expect(groups).toEqual([
      expect.objectContaining({ id: 'session:sess-auth', heading: 'Implemented auth login fixes.' }),
      expect.objectContaining({ id: 'session:sess-billing', heading: 'Implemented billing retry fixes.' }),
    ]);
  });

  it('merges candidates with the same session and topic into one group', () => {
    const groups = groupRecallCandidates([
      candidate({ sessionId: 'sess-auth', topicKey: 'auth_strategy', eventIds: ['evt-1'] }),
      candidate({
        sessionId: 'sess-auth',
        topicKey: 'auth_strategy',
        eventIds: ['evt-2'],
        headline: 'Confirmed GitHub OAuth for auth.',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'session:sess-auth:topic:auth_strategy',
      heading: 'Implemented auth login fixes.',
      eventIds: ['evt-1', 'evt-2'],
      candidates: [expect.any(Object), expect.any(Object)],
    });
  });

  it('exposes concise headings for clarification groups', () => {
    const groups = groupRecallCandidates([
      candidate({
        sessionId: 'sess-long',
        headline:
          'This is a very long task summary that should be clipped before being shown as a clarification heading to the agent.',
      }),
    ]);

    expect(groups[0]?.heading.length).toBeLessThanOrEqual(80);
  });
});

describe('buildRecallResult', () => {
  it('returns no_memory when no groups exist', () => {
    expect(buildRecallResult({ question: 'what did we do?', candidates: [] })).toEqual({
      status: 'no_memory',
      question: 'what did we do?',
      summary: 'No matching memory found.',
      candidates: [],
      candidateGroups: [],
    });
  });

  it('returns ok for one strong group', () => {
    const result = buildRecallResult({
      question: 'what did we decide?',
      candidates: [candidate({ score: 18, confidence: 'high' })],
    });

    expect(result).toMatchObject({
      status: 'ok',
      summary: 'Implemented auth login fixes.',
      candidates: [expect.any(Object)],
      candidateGroups: [expect.any(Object)],
    });
  });

  it('returns needs_clarification for multiple close groups', () => {
    const result = buildRecallResult({
      question: 'what did we implement?',
      candidates: [
        candidate({ sessionId: 'sess-auth', eventIds: ['evt-auth'], score: 12 }),
        candidate({
          sessionId: 'sess-billing',
          eventIds: ['evt-billing'],
          headline: 'Implemented billing retry fixes.',
          score: 11,
        }),
      ],
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.candidateGroups).toHaveLength(2);
  });
});
