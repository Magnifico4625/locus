import { describe, expect, it } from 'vitest';
import {
  formatEvidenceWhyStored,
  normalizeDurableEvidence,
} from '../../src/memory/evidence.js';

describe('normalizeDurableEvidence', () => {
  it('normalizes supported durable evidence fields', () => {
    expect(
      normalizeDurableEvidence({
        confidence: 0.91,
        reason: 'decision_phrase',
        matchedPattern: 'решили',
        eventId: 'evt-123',
        sessionId: 'sess-456',
      }),
    ).toEqual({
      confidence: 0.91,
      reason: 'decision_phrase',
      matchedPattern: 'решили',
      sourceEventId: 'evt-123',
      sessionId: 'sess-456',
    });
  });

  it('accepts sourceEventId when eventId is absent', () => {
    expect(
      normalizeDurableEvidence({
        sourceEventId: 'source-evt-1',
      }),
    ).toEqual({
      sourceEventId: 'source-evt-1',
    });
  });

  it('drops missing and invalid evidence fields without throwing', () => {
    expect(
      normalizeDurableEvidence({
        confidence: 'high',
        reason: '',
        matchedPattern: 42,
        eventId: null,
        sourceEventId: ['evt'],
        sessionId: {},
      }),
    ).toEqual({});

    expect(normalizeDurableEvidence(undefined)).toEqual({});
    expect(normalizeDurableEvidence(null)).toEqual({});
  });
});

describe('formatEvidenceWhyStored', () => {
  it('formats a concise why-stored explanation from normalized evidence', () => {
    expect(
      formatEvidenceWhyStored('decision', {
        confidence: 0.91,
        reason: 'decision_phrase',
        matchedPattern: 'решили',
        sourceEventId: 'evt-123',
        sessionId: 'sess-456',
      }),
    ).toBe(
      'Stored as decision because matched "решили" with 91% confidence from session sess-456.',
    );
  });

  it('falls back to available fields when evidence is sparse', () => {
    expect(formatEvidenceWhyStored('preference', { sourceEventId: 'evt-123' })).toBe(
      'Stored as preference from event evt-123.',
    );
  });
});
