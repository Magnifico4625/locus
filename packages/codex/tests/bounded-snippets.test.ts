import { describe, expect, it } from 'vitest';
import { boundCodexSnippet } from '../src/bounded-snippets.js';

describe('boundCodexSnippet', () => {
  it('keeps short bug context unchanged', () => {
    expect(
      boundCodexSnippet('Parser fails on empty input after the lexer rewrite.', {
        role: 'user',
        reason: 'bug_context',
      }),
    ).toEqual({
      text: 'Parser fails on empty input after the lexer rewrite.',
      truncated: false,
    });
  });

  it('clips long assistant rambling to a bounded snippet', () => {
    const longAssistantText = [
      'I inspected the parser stack and the crash appears after the nullable token pass.',
      'The relevant decision is to keep the fix surgical inside parseNullableBranch.',
      'Extra filler that should not survive because redacted mode must not turn into a transcript dump.',
      'More filler to prove the helper truncates long assistant reasoning.',
    ].join(' ');

    const snippet = boundCodexSnippet(longAssistantText, {
      role: 'assistant',
      reason: 'decision',
    });

    expect(snippet.truncated).toBe(true);
    expect(snippet.text).toContain('nullable token pass');
    expect(snippet.text).toContain('fix surgical');
    expect(snippet.text.length).toBeLessThan(longAssistantText.length);
  });
});
