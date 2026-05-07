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

  it('allows bug context to keep more detail than style', () => {
    const text = [
      'Root cause: the JSONL importer skipped task_complete summaries after debounce.',
      'The failing path was repeated-search auto-import with redacted capture enabled.',
      'The fix should keep enough context for the next agent to understand the bug.',
    ].join(' ');

    const bugSnippet = boundCodexSnippet(text, {
      role: 'assistant',
      reason: 'bug_context',
    });
    const styleSnippet = boundCodexSnippet(text, {
      role: 'assistant',
      reason: 'style',
    });

    expect(bugSnippet.text.length).toBeGreaterThan(styleSnippet.text.length);
    expect(styleSnippet.text).toContain('Root cause');
    expect(styleSnippet.text).not.toContain('The failing path');
  });

  it('keeps enough validation fact command context', () => {
    const text = [
      'Validation passed: npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts completed with 64 tests.',
      'Typecheck passed: npm -w @locus/core run typecheck.',
      'Whitespace check passed: git diff --check.',
      'Extra narrative should not be needed for recall.',
    ].join(' ');

    const snippet = boundCodexSnippet(text, {
      role: 'assistant',
      reason: 'validation_fact',
    });

    expect(snippet.text).toContain('npm test -- packages/core/tests/recall');
    expect(snippet.text).toContain('npm -w @locus/core run typecheck');
    expect(snippet.text).toContain('git diff --check');
    expect(snippet.text).not.toContain('Extra narrative');
  });

  it.each([
    'noise',
    'bug_context',
    'decision',
    'preference',
    'style',
    'constraint',
    'rejected_alternative',
    'validation_fact',
    'release_context',
    'next_step',
    'general_context',
  ] as const)('respects the global hard max for %s', (reason) => {
    const snippet = boundCodexSnippet('A'.repeat(2_000), {
      role: 'user',
      reason,
    });

    expect(snippet.text.length).toBeLessThanOrEqual(640);
    expect(snippet.truncated).toBe(true);
  });

  it('counts the truncation marker inside the reason character limit', () => {
    const snippet = boundCodexSnippet('A'.repeat(2_000), {
      role: 'user',
      reason: 'bug_context',
    });

    expect(snippet.text).toMatch(/ \.\.\.$/);
    expect(snippet.text.length).toBeLessThanOrEqual(600);
  });

  it('still limits sentence count to prevent transcript dumps', () => {
    const text = [
      'First sentence captures the important bug.',
      'Second sentence keeps supporting context.',
      'Third sentence should survive for bug context.',
      'Fourth sentence should survive for bug context.',
      'Fifth sentence must be dropped.',
      'Sixth sentence must also be dropped.',
    ].join(' ');

    const snippet = boundCodexSnippet(text, {
      role: 'assistant',
      reason: 'bug_context',
    });

    expect(snippet.text).toContain('Fourth sentence');
    expect(snippet.text).not.toContain('Fifth sentence');
  });
});
