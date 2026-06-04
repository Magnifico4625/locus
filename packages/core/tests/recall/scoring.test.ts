import { describe, expect, it } from 'vitest';
import type { ParsedRecallQuery } from '../../src/recall/query-parser.js';
import { filterProjectCandidates, scoreRecallCandidate } from '../../src/recall/scoring.js';
import type { MemoryRecallCandidate } from '../../src/types.js';

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
    const match = scoreRecallCandidate(candidate({ topicKey: 'auth_strategy' }), parsedQuery(), {
      now,
    });
    const mismatch = scoreRecallCandidate(
      candidate({ topicKey: 'database_choice' }),
      parsedQuery(),
      { now },
    );

    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.reasons).toContain('topic_match');
  });

  it('scores recent candidates higher than old candidates', () => {
    const recent = scoreRecallCandidate(candidate({ timestamp: now - 60_000 }), parsedQuery(), {
      now,
    });
    const old = scoreRecallCandidate(
      candidate({ timestamp: now - 45 * 24 * 60 * 60 * 1000 }),
      parsedQuery(),
      {
        now,
      },
    );

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
    const match = scoreRecallCandidate(candidate({ captureReason: 'decision' }), parsedQuery(), {
      now,
    });
    const mismatch = scoreRecallCandidate(
      candidate({ captureReason: 'bug_context' }),
      parsedQuery(),
      { now },
    );

    expect(match.score).toBeGreaterThan(mismatch.score);
    expect(match.reasons).toContain('capture_reason_match');
  });

  it('prefers completion events for bug and work summary recall', () => {
    const completion = scoreRecallCandidate(
      candidate({ captureReason: 'task_complete' }),
      parsedQuery({ intent: 'bug_context' }),
      { now },
    );
    const prompt = scoreRecallCandidate(
      candidate({ captureReason: 'user_prompt' }),
      parsedQuery({ intent: 'bug_context' }),
      { now },
    );

    expect(completion.score).toBeGreaterThan(prompt.score);
    expect(completion.reasons).toContain('completion_event');
  });

  it('prefers validation facts with command context', () => {
    const command = scoreRecallCandidate(
      candidate({
        headline:
          'Validation passed: npm test -- packages/cli/tests/codex-install.test.ts and npm -w @locus/cli run typecheck.',
        sourceKind: 'durable',
        durableMemoryIds: [1],
        eventIds: [],
      }),
      parsedQuery({ intent: 'validation_fact', terms: [], termVariants: [] }),
      { now },
    );
    const generic = scoreRecallCandidate(
      candidate({
        headline: 'Validation session completed after the install path fix.',
        sourceKind: 'durable',
        durableMemoryIds: [2],
        eventIds: [],
      }),
      parsedQuery({ intent: 'validation_fact', terms: [], termVariants: [] }),
      { now },
    );

    expect(command.score).toBeGreaterThan(generic.score);
    expect(command.reasons).toContain('validation_command_context');
  });

  it('drops explicit other-project candidates before scoring', () => {
    const kept = filterProjectCandidates(
      [
        candidate({
          projectRoot: 'c:/repo/locus',
          headline: 'Locus memory work',
          eventIds: ['evt-locus'],
          durableMemoryIds: [],
        }),
        candidate({
          projectRoot: 'c:/repo/proxyvpn',
          headline: 'ProxyVpn memory work',
          eventIds: ['evt-proxy'],
          durableMemoryIds: [],
        }),
        candidate({
          projectRoot: undefined,
          headline: 'Legacy memory work',
          eventIds: [],
          durableMemoryIds: [],
          sourceKind: 'semantic',
        }),
      ],
      'C:/repo/locus',
    );

    expect(kept.map((candidate) => candidate.headline)).toEqual([
      'Locus memory work',
      'Legacy memory work',
    ]);
  });

  it('adds project, time range, and exact entity scoring factors', () => {
    const result = scoreRecallCandidate(
      candidate({
        projectRoot: 'c:/repo/locus',
        headline: 'Locus v3.6.1 CODEX_HOME memory_recall work.',
        matchedTerms: ['v3.6.1', 'CODEX_HOME', 'memory_recall'],
        timestamp: now - 60_000,
      }),
      parsedQuery({
        original: 'what happened with v3.6.1 CODEX_HOME memory_recall?',
        terms: ['v3.6.1', 'CODEX_HOME', 'memory_recall'],
        termVariants: ['v3.6.1', 'CODEX_HOME', 'memory_recall'],
      }),
      {
        now,
        projectRoot: 'C:/repo/locus',
        resolvedRange: { from: now - 3_600_000, to: now + 1_000 },
      },
    );

    expect(result.reasons).toEqual(
      expect.arrayContaining(['project_match', 'time_range_fit', 'exact_entity_match']),
    );
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it('penalizes legacy global candidates that survive fallback', () => {
    const result = scoreRecallCandidate(
      candidate({
        projectRoot: undefined,
        headline: 'legacy CODEX_HOME import',
        matchedTerms: ['CODEX_HOME'],
        sourceKind: 'semantic',
      }),
      parsedQuery({
        original: 'CODEX_HOME import',
        terms: ['CODEX_HOME', 'import'],
        termVariants: ['CODEX_HOME', 'import'],
      }),
      { now, projectRoot: 'C:/repo/locus' },
    );

    expect(result.reasons).toContain('legacy_global');
    expect(result.score).toBeLessThan(
      scoreRecallCandidate(
        candidate({
          projectRoot: 'c:/repo/locus',
          headline: 'scoped CODEX_HOME import',
          matchedTerms: ['CODEX_HOME'],
          sourceKind: 'semantic',
        }),
        parsedQuery({
          original: 'CODEX_HOME import',
          terms: ['CODEX_HOME', 'import'],
          termVariants: ['CODEX_HOME', 'import'],
        }),
        { now, projectRoot: 'C:/repo/locus' },
      ).score,
    );
  });
});
