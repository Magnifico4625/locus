import { describe, expect, it } from 'vitest';
import { parseRecallQuery } from '../../src/recall/query-parser.js';

const now = Date.parse('2026-05-04T12:00:00.000Z');

describe('parseRecallQuery', () => {
  it.each([
    ['what did we decide about auth yesterday?', 'decision'],
    ['что решили по capture strategy вчера?', 'decision'],
    ['what did we do last week?', 'work_summary'],
    ['что мы делали вчера?', 'work_summary'],
    ['что делали на прошлой неделе?', 'work_summary'],
    ['which errors happened during npm install?', 'bug_context'],
    ['what did we just fix in Codex recall?', 'bug_context'],
    ['какие были ошибки при npm install?', 'bug_context'],
    ['what is my code style?', 'preference_style'],
    ['какой у меня стиль работы?', 'preference_style'],
    ['why did we reject hook-first capture?', 'rejected_alternative'],
    ['почему отказались от hook-first?', 'rejected_alternative'],
    ['what remains to do?', 'next_step'],
    ['что осталось сделать?', 'next_step'],
    ['what passed validation?', 'validation_fact'],
    ['что реально проверено?', 'validation_fact'],
    ['tell me about the project', 'general'],
    ['расскажи про проект', 'general'],
  ])('detects %s as %s', (question, intent) => {
    expect(parseRecallQuery(question, now).intent).toBe(intent);
  });

  it('includes temporal range from the temporal parser', () => {
    expect(parseRecallQuery('что решили вчера?', now).temporalRange).toMatchObject({
      label: 'вчера',
      fromIso: '2026-05-03T00:00:00.000Z',
      toIso: '2026-05-04T00:00:00.000Z',
    });
  });

  it('returns normalized and stop-word-filtered terms', () => {
    expect(parseRecallQuery('What did we decide about GitHub OAuth yesterday?', now)).toMatchObject({
      normalizedTerms: ['what', 'did', 'we', 'decide', 'about', 'github', 'oauth', 'yesterday'],
      terms: ['github', 'oauth'],
    });
  });

  it('does not keep RU pronouns as search terms for timeline-style recall', () => {
    expect(parseRecallQuery('Что мы делали вчера?', now)).toMatchObject({
      intent: 'work_summary',
      terms: [],
      termVariants: [],
    });
  });

  it('adds RU stem-lite variants for common morphology', () => {
    expect(parseRecallQuery('какие были ошибки и ошибку при npm install?', now)).toMatchObject({
      terms: expect.arrayContaining(['ошибки', 'ошибку', 'npm', 'install']),
      termVariants: expect.arrayContaining(['ошибк', 'npm', 'install']),
    });
  });

  it('extracts obvious topic hints without overfitting', () => {
    expect(parseRecallQuery('what did we decide about auth strategy?', now).topicHints).toEqual([
      'auth_strategy',
    ]);
    expect(parseRecallQuery('что решили по capture strategy?', now).topicHints).toEqual([
      'capture_strategy',
    ]);
  });
});
