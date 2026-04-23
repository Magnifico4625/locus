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
      evidence: { source: 'newer-decision' },
      sourceEventId: 'evt-new',
      source: 'codex' as const,
    };

    expect(mergeDurableCandidate([existing], candidate)).toEqual({
      action: 'supersede_existing',
      existingId: 9,
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
