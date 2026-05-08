import { describe, expect, it } from 'vitest';
import { deriveTopicKey } from '../../src/memory/topic-keys.js';

describe('deriveTopicKey', () => {
  it('classifies durable database decisions under database_choice', () => {
    expect(
      deriveTopicKey({
        memoryType: 'decision',
        summary: 'Use SQLite for the local durable memory store in Codex.',
      }),
    ).toBe('database_choice');
  });

  it('classifies Russian database decisions under the same canonical key', () => {
    expect(
      deriveTopicKey({
        memoryType: 'decision',
        summary: 'Мы решили использовать PostgreSQL для долговременной памяти.',
      }),
    ).toBe('database_choice');
  });

  it('delegates new Track C memory types to the canonical registry', () => {
    expect(
      deriveTopicKey({
        memoryType: 'rejected_alternative',
        summary: 'Отказались от hook-first capture, потому что это риск для релиза.',
      }),
    ).toBe('codex_hooks_strategy');
  });

  it('classifies authentication strategy decisions under auth_strategy', () => {
    expect(
      deriveTopicKey({
        memoryType: 'decision',
        summary: 'Use GitHub OAuth as the primary authentication strategy.',
      }),
    ).toBe('auth_strategy');
  });

  it('returns undefined when a durable fact does not belong to a stable topic family', () => {
    expect(
      deriveTopicKey({
        memoryType: 'constraint',
        summary: 'Keep the patch small and verify before claiming success.',
      }),
    ).toBeUndefined();
  });
});
