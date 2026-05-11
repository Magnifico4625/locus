import { describe, expect, it } from 'vitest';
import { classifyCodexRelevance } from '../src/relevance.js';

describe('classifyCodexRelevance', () => {
  it.each([
    ['Explain what monads are in functional programming.', 'user'],
    ['Что такое монады в функциональном программировании?', 'user'],
    ['Sure, I can explain that in general terms.', 'assistant'],
    ['Понял, могу рассказать подробнее для общего развития.', 'assistant'],
  ] as const)('rejects generic learning or small talk as noise: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({ keep: false, reason: 'noise' });
  });

  it.each([
    'The parser crashes with null input after the refactor. Help me isolate the failing branch.',
    'После рефакторинга парсер падает на пустом input, нужно найти причину.',
  ])('keeps concrete bug-fixing context from the user: %s', (text) => {
    expect(classifyCodexRelevance(text, 'user')).toEqual({ keep: true, reason: 'bug_context' });
  });

  it('detects explicit user preferences', () => {
    expect(
      classifyCodexRelevance('Keep the fix surgical and do not touch unrelated modules.', 'user'),
    ).toEqual({
      keep: true,
      reason: 'preference',
    });
  });

  it.each([
    ['Use SQLite cache for live recall instead of JSON sidecars.', 'user'],
    ['Решили использовать SQLite cache для live recall.', 'user'],
  ] as const)('detects decisions: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({ keep: true, reason: 'decision' });
  });

  it.each([
    ['My style is short direct progress reports and approval gates between tasks.', 'user'],
    [
      'Мой стиль работы: короткие отчеты и переход к следующей задаче только после одобрения.',
      'user',
    ],
  ] as const)('detects style preferences: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({ keep: true, reason: 'style' });
  });

  it.each([
    ['Constraint: do not modify packages/claude-code during Codex-first work.', 'user'],
    ['Ограничение: не трогай packages/claude-code без необходимости.', 'user'],
  ] as const)('detects constraints: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({ keep: true, reason: 'constraint' });
  });

  it.each([
    ['We rejected hook-first capture because it was not stable enough for v3.6.0.', 'user'],
    ['Отказались от hook-first capture, потому что это риск для релиза.', 'user'],
  ] as const)('detects rejected alternatives: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({
      keep: true,
      reason: 'rejected_alternative',
    });
  });

  it.each([
    ['Validation passed: npm test and npm -w @locus/core run typecheck are green.', 'assistant'],
    ['Проверено: npm test прошел, typecheck зеленый.', 'assistant'],
  ] as const)('detects validation facts: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({
      keep: true,
      reason: 'validation_fact',
    });
  });

  it.each([
    [
      'Root cause: capture mode was metadata, so semantic recall had no dialogue content.',
      'assistant',
    ],
    ['Fixed the durable runner watermark recall gap and kept debounce intact.', 'assistant'],
    [
      'Причина: JSONL импорт работал, но redacted snippets не сохраняли нужный контекст.',
      'assistant',
    ],
  ] as const)('keeps assistant root-cause and fix summaries: %s', (text, role) => {
    expect(classifyCodexRelevance(text, role)).toEqual({ keep: true, reason: 'bug_context' });
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
