import { describe, expect, it } from 'vitest';
import { classifyCodexRelevance } from '../src/relevance.js';

describe('classifyCodexRelevance', () => {
  it('rejects generic learning chatter as noise', () => {
    expect(
      classifyCodexRelevance('Explain what monads are in functional programming.', 'user'),
    ).toEqual({
      keep: false,
      reason: 'noise',
    });
  });

  it('keeps concrete bug-fixing context from the user', () => {
    expect(
      classifyCodexRelevance(
        'The parser crashes with null input after the refactor. Help me isolate the failing branch.',
        'user',
      ),
    ).toEqual({
      keep: true,
      reason: 'bug_context',
    });
  });

  it('detects explicit user preferences', () => {
    expect(
      classifyCodexRelevance(
        'Keep the fix surgical and do not touch unrelated modules.',
        'user',
      ),
    ).toEqual({
      keep: true,
      reason: 'preference',
    });
  });

  it('detects assistant next-step planning', () => {
    expect(
      classifyCodexRelevance(
        'Next I will add the failing test, run the focused suite, and then wire the importer.',
        'assistant',
      ),
    ).toEqual({
      keep: true,
      reason: 'next_step',
    });
  });
});
