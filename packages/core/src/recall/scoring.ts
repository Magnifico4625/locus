import type { MemoryRecallCandidate, MemoryRecallConfidence } from '../types.js';
import type { ParsedRecallQuery } from './query-parser.js';

export interface RecallScoreResult {
  candidate: MemoryRecallCandidate;
  score: number;
  confidence: MemoryRecallConfidence;
  reasons: string[];
}

export interface RecallScoringOptions {
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DURABLE_PRIORITY_INTENTS = new Set(['decision', 'preference_style']);
const COMPLETION_EVENT_INTENTS = new Set(['bug_context', 'validation_fact', 'work_summary']);
const COMPLETION_CAPTURE_REASONS = new Set(['session_end', 'task_complete']);

function confidenceForScore(score: number): MemoryRecallConfidence {
  if (score >= 12) {
    return 'high';
  }

  if (score >= 6) {
    return 'medium';
  }

  return 'low';
}

function recencyScore(timestamp: number, now: number): number {
  const ageDays = Math.max(0, (now - timestamp) / DAY_MS);
  if (ageDays <= 1) {
    return 3;
  }
  if (ageDays <= 7) {
    return 2;
  }
  if (ageDays <= 30) {
    return 1;
  }
  return 0;
}

export function scoreRecallCandidate(
  candidate: MemoryRecallCandidate,
  parsedQuery: ParsedRecallQuery,
  options: RecallScoringOptions,
): RecallScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.intent === parsedQuery.intent) {
    score += 3;
    reasons.push('intent_match');
  }

  if (candidate.topicKey && parsedQuery.topicHints.includes(candidate.topicKey)) {
    score += 4;
    reasons.push('topic_match');
  }

  if (candidate.matchedTerms && candidate.matchedTerms.length > 0) {
    score += Math.min(candidate.matchedTerms.length, 4);
    reasons.push('term_overlap');
  }

  if (typeof candidate.timestamp === 'number') {
    const bonus = recencyScore(candidate.timestamp, options.now);
    if (bonus > 0) {
      score += bonus;
      reasons.push('recent');
    }
  }

  if (
    candidate.sourceKind === 'durable' &&
    DURABLE_PRIORITY_INTENTS.has(parsedQuery.intent)
  ) {
    score += 3;
    reasons.push('durable_priority');
  }

  if (candidate.captureReason === parsedQuery.intent) {
    score += 2;
    reasons.push('capture_reason_match');
  }

  if (
    candidate.captureReason &&
    COMPLETION_CAPTURE_REASONS.has(candidate.captureReason) &&
    COMPLETION_EVENT_INTENTS.has(parsedQuery.intent)
  ) {
    score += 5;
    reasons.push('completion_event');
  }

  if (candidate.eventIds.length > 0 || candidate.durableMemoryIds.length > 0) {
    score += 1;
    reasons.push('evidence_present');
  }

  const confidence = confidenceForScore(score);
  return {
    candidate: {
      ...candidate,
      score,
      confidence,
    },
    score,
    confidence,
    reasons,
  };
}

export function scoreRecallCandidates(
  candidates: MemoryRecallCandidate[],
  parsedQuery: ParsedRecallQuery,
  options: RecallScoringOptions,
): MemoryRecallCandidate[] {
  return candidates
    .map((candidate) => scoreRecallCandidate(candidate, parsedQuery, options).candidate)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
