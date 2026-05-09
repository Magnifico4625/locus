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

  it('classifies Codex capture strategy decisions under capture_strategy', () => {
    expect(
      deriveTopicKey({
        memoryType: 'decision',
        summary:
          'capture strategy stays local and rule-based with high-value snippets in redacted mode.',
      }),
    ).toBe('capture_strategy');
  });

  it('classifies Track C acceptance next steps under track_c_acceptance', () => {
    expect(
      deriveTopicKey({
        memoryType: 'next_step',
        summary:
          'Next I will update the acceptance matrix and docs after the Track C recall fixtures pass.',
      }),
    ).toBe('track_c_acceptance');
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
