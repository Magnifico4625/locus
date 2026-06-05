import { describe, expect, it } from 'vitest';
import { mergeDurableCandidate } from '../../src/memory/durable-merge.js';
import type { DurableMemoryEntry } from '../../src/types.js';

function makeDurableEntry(overrides: Partial<DurableMemoryEntry>): DurableMemoryEntry {
  return {
    id: 1,
    topicKey: undefined,
    memoryType: 'decision',
    state: 'active',
    summary: 'Default summary',
    evidence: { confidence: 'high' },
    sourceEventId: 'evt-1',
    source: 'codex',
    supersededById: undefined,
    createdAt: Date.parse('2026-04-22T08:00:00.000Z'),
    updatedAt: Date.parse('2026-04-22T08:00:00.000Z'),
    ...overrides,
  };
}

describe('mergeDurableCandidate', () => {
  it('confirms an existing durable entry instead of inserting a duplicate', () => {
    const existing = makeDurableEntry({
      id: 7,
      topicKey: 'database_choice',
      summary: 'Use SQLite for the local durable memory store.',
    });

    const candidate = {
      topicKey: 'database_choice',
      memoryType: 'decision' as const,
      summary: 'Use SQLite for the local durable memory store.',
      evidence: { source: 'repeat-confirmation' },
      sourceEventId: 'evt-repeat',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'confirm_existing',
      existingId: 7,
    });
  });

  it('confirms an existing durable entry using normalized summaries', () => {
    const existing = makeDurableEntry({
      id: 8,
      topicKey: 'database_choice',
      summary: 'Use SQLite for the local durable memory store.',
    });

    const candidate = {
      topicKey: 'database_choice',
      memoryType: 'decision' as const,
      summary: 'use sqlite for the local durable memory store',
      evidence: { source: 'repeat-confirmation', confidence: 0.9 },
      sourceEventId: 'evt-repeat-normalized',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'confirm_existing',
      existingId: 8,
    });
  });

  it('confirms an existing Russian durable entry using Unicode-aware normalized summaries', () => {
    const existing = makeDurableEntry({
      id: 10,
      topicKey: 'database_choice',
      summary: 'Решили использовать PostgreSQL для долговременной памяти.',
    });

    const candidate = {
      topicKey: 'database_choice',
      memoryType: 'decision' as const,
      summary: 'решили использовать postgresql для долговременной памяти',
      evidence: { source: 'repeat-confirmation', confidence: 0.9 },
      sourceEventId: 'evt-repeat-ru-normalized',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'confirm_existing',
      existingId: 10,
    });
  });

  it('supersedes an older active entry when a newer conflicting decision shares the same topic key', () => {
    const existing = makeDurableEntry({
      id: 9,
      topicKey: 'database_choice',
      summary: 'Use PostgreSQL for the dashboard store.',
    });

    const candidate = {
      topicKey: 'database_choice',
      memoryType: 'decision' as const,
      summary: 'Use SQLite for the local durable memory store.',
      evidence: { source: 'newer-decision', confidence: 0.9 },
      sourceEventId: 'evt-new',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'supersede_existing',
      existingId: 9,
    });
  });

  it.each([
    ['preference', 'user_workflow_style'],
    ['constraint', 'codex_hooks_strategy'],
    ['next_step', 'release_steps'],
  ] as const)('supersedes an older active %s when the newer candidate shares the same topic key', (memoryType, topicKey) => {
    const existing = makeDurableEntry({
      id: 11,
      topicKey,
      memoryType,
      summary: `Old ${memoryType} summary.`,
    });

    const candidate = {
      topicKey,
      memoryType,
      summary: `New ${memoryType} summary.`,
      evidence: { source: 'newer-memory', confidence: 0.9 },
      sourceEventId: 'evt-newer-memory',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'supersede_existing',
      existingId: 11,
    });
  });

  it('does not supersede rejected alternatives by default', () => {
    const existing = makeDurableEntry({
      id: 12,
      topicKey: 'codex_hooks_strategy',
      memoryType: 'rejected_alternative',
      summary: 'Rejected hook-first capture because it risks startup stability.',
    });

    const candidate = {
      topicKey: 'codex_hooks_strategy',
      memoryType: 'rejected_alternative' as const,
      summary: 'Rejected direct SQLite hooks because they can hit SQLITE_BUSY.',
      evidence: { source: 'new-rejection', confidence: 0.9 },
      sourceEventId: 'evt-rejected-new',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'insert_new_active',
    });
  });

  it('supersedes an active next_step when a same-topic validation_fact resolves it', () => {
    const existing = makeDurableEntry({
      id: 10,
      topicKey: 'track_d_memory_reliability',
      memoryType: 'next_step',
      summary: 'Implement Track D project-scoped recall tests.',
    });

    const candidate = {
      topicKey: 'track_d_memory_reliability',
      memoryType: 'validation_fact' as const,
      summary: 'Validation passed: Track D project-scoped recall tests.',
      evidence: { source: 'test', confidence: 0.9 },
      sourceEventId: 'evt-new',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'supersede_existing',
      existingId: 10,
    });
  });

  it('does not supersede next_step when validation wording is negative', () => {
    const existing = makeDurableEntry({
      id: 10,
      topicKey: 'track_d_memory_reliability',
      memoryType: 'next_step',
      summary: 'Pass Track D review.',
    });

    const candidate = {
      topicKey: 'track_d_memory_reliability',
      memoryType: 'validation_fact' as const,
      summary: "This hasn't passed review yet.",
      evidence: { source: 'test', confidence: 0.9 },
      sourceEventId: 'evt-new',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate).action).not.toBe('supersede_existing');
  });

  it('keeps both memories when a topic collision has no mapping confidence', () => {
    const existing = makeDurableEntry({
      id: 13,
      topicKey: 'database_choice',
      summary: 'Use PostgreSQL for shared server storage.',
    });

    const candidate = {
      topicKey: 'database_choice',
      memoryType: 'decision' as const,
      summary: 'Use SQLite for local cache storage.',
      evidence: { source: 'legacy-candidate-without-confidence' },
      sourceEventId: 'evt-no-confidence',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'insert_new_active',
    });
  });

  it('does not supersede active entries when the candidate has no topic key', () => {
    const existing = makeDurableEntry({
      id: 14,
      topicKey: undefined,
      memoryType: 'decision',
      summary: 'Use PostgreSQL for storage.',
    });

    const candidate = {
      topicKey: undefined,
      memoryType: 'decision' as const,
      summary: 'Use SQLite for storage.',
      evidence: { source: 'topicless-candidate', confidence: 0.9 },
      sourceEventId: 'evt-topicless',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'insert_new_active',
    });
  });

  it('inserts a new active durable entry when there is no matching topic family', () => {
    const candidate = {
      topicKey: 'auth_strategy',
      memoryType: 'decision' as const,
      summary: 'Use GitHub OAuth as the auth strategy.',
      evidence: { source: 'fresh-decision' },
      sourceEventId: 'evt-auth',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([], candidate)).toEqual({
      action: 'insert_new_active',
    });
  });
});
