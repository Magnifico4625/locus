import { describe, expect, it } from 'vitest';
import { deriveCanonicalTopicKey } from '../../src/memory/topic-key-registry.js';

describe('deriveCanonicalTopicKey', () => {
  it('maps English database decisions to a canonical English topic key', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'decision',
        summary: 'Decided to use PostgreSQL for durable memory storage.',
      }),
    ).toBe('database_choice');
  });

  it('maps Russian database decisions to the same canonical English topic key', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'decision',
        summary: 'Мы решили использовать PostgreSQL для долговременной памяти.',
      }),
    ).toBe('database_choice');
  });

  it('maps rejected Codex hook alternatives to a canonical strategy topic', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'rejected_alternative',
        summary: 'Отказались от hook-first capture, потому что это риск для релиза.',
      }),
    ).toBe('codex_hooks_strategy');
  });

  it('maps user workflow preferences to a canonical style topic', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'preference',
        summary: 'I prefer one task at a time with approval gates.',
      }),
    ).toBe('user_workflow_style');
  });

  it('returns undefined for low-confidence unknown mappings', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'decision',
        summary: 'Discussed a random implementation detail briefly.',
      }),
    ).toBeUndefined();
  });

  it('never emits translated topic keys', () => {
    expect(
      deriveCanonicalTopicKey({
        memoryType: 'decision',
        summary: 'Мы решили использовать PostgreSQL.',
      }),
    ).not.toBe('выбор_базы');
  });
});
