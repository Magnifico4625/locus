import type { MemoryRecallCandidate, MemoryRecallConfidence } from '../types.js';
import type { ParsedRecallQuery } from './query-parser.js';
import { isSameProjectRoot } from './project-scope.js';

export interface RecallScoreResult {
  candidate: MemoryRecallCandidate;
  score: number;
  confidence: MemoryRecallConfidence;
  reasons: string[];
}

export interface RecallScoringOptions {
  now: number;
  projectRoot?: string;
  resolvedRange?: { from: number; to: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DURABLE_PRIORITY_INTENTS = new Set([
  'decision',
  'preference_style',
  'rejected_alternative',
  'next_step',
  'validation_fact',
]);
const COMPLETION_EVENT_INTENTS = new Set(['bug_context', 'validation_fact', 'work_summary']);
const COMPLETION_CAPTURE_REASONS = new Set(['session_end', 'task_complete']);
const VALIDATION_COMMAND_PATTERN =
  /\b(?:npm\s+(?:test|-w)|typecheck|vitest|pytest|cargo\s+test)\b/i;

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

function exactEntityTokens(values: readonly string[]): string[] {
  return values.filter((value) =>
    /^(?:v?\d+\.\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]{2,}|memory_[a-z_]+|[@\w.-]+\/[\w.-]+|[\w./-]+\.(?:ts|tsx|js|mjs|md|json))$/u.test(
      value,
    ),
  );
}

function hasExactEntityMatch(
  candidate: MemoryRecallCandidate,
  parsedQuery: ParsedRecallQuery,
): boolean {
  const rawTokens = parsedQuery.original
    .split(/\s+/u)
    .map((token) => token.replace(/^[,;:!?()[\]{}"']+|[,;:!?()[\]{}"']+$/gu, ''))
    .filter(Boolean);
  const entities = exactEntityTokens([
    ...rawTokens,
    ...parsedQuery.terms,
    ...parsedQuery.normalizedTerms,
  ]);
  if (entities.length === 0) {
    return false;
  }

  const haystack = [
    candidate.headline,
    ...(candidate.matchedTerms ?? []),
    candidate.topicKey ?? '',
    candidate.captureReason ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return entities.some((entity) => haystack.includes(entity.toLowerCase()));
}

export function filterProjectCandidates(
  candidates: MemoryRecallCandidate[],
  projectRoot?: string,
): MemoryRecallCandidate[] {
  if (!projectRoot) {
    return candidates;
  }

  return candidates.filter(
    (candidate) => !candidate.projectRoot || isSameProjectRoot(candidate.projectRoot, projectRoot),
  );
}

export function scoreRecallCandidate(
  candidate: MemoryRecallCandidate,
  parsedQuery: ParsedRecallQuery,
  options: RecallScoringOptions,
): RecallScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (
    options.projectRoot &&
    candidate.projectRoot &&
    isSameProjectRoot(candidate.projectRoot, options.projectRoot)
  ) {
    score += 10;
    reasons.push('project_match');
  }

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
    if (
      options.resolvedRange &&
      candidate.timestamp >= options.resolvedRange.from &&
      candidate.timestamp < options.resolvedRange.to
    ) {
      score += 5;
      reasons.push('time_range_fit');
    }

    const bonus = recencyScore(candidate.timestamp, options.now);
    if (bonus > 0) {
      score += bonus;
      reasons.push('recent');
    }
  }

  if (candidate.sourceKind === 'durable' && DURABLE_PRIORITY_INTENTS.has(parsedQuery.intent)) {
    score += 3;
    reasons.push('durable_priority');
  }

  if (candidate.sourceKind === 'semantic') {
    score += 2;
    reasons.push('explicit_memory');
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

  if (
    parsedQuery.intent === 'validation_fact' &&
    VALIDATION_COMMAND_PATTERN.test(candidate.headline)
  ) {
    score += 3;
    reasons.push('validation_command_context');
  }

  if (hasExactEntityMatch(candidate, parsedQuery)) {
    score += 4;
    reasons.push('exact_entity_match');
  }

  if (
    candidate.eventIds.length > 0 ||
    candidate.durableMemoryIds.length > 0 ||
    candidate.sourceKind === 'semantic'
  ) {
    score += 1;
    reasons.push('evidence_present');
  }

  if (options.projectRoot && !candidate.projectRoot) {
    score -= 4;
    reasons.push('legacy_global');
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
