import type { DurableMemoryType } from '../types.js';

export interface NormalizedDurableEvidence {
  confidence?: number;
  reason?: string;
  matchedPattern?: string;
  sourceEventId?: string;
  sessionId?: string;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

export function normalizeDurableEvidence(
  evidence: Record<string, unknown> | null | undefined,
): NormalizedDurableEvidence {
  if (!evidence) {
    return {};
  }

  const sourceEventId =
    readNonEmptyString(evidence.eventId) ?? readNonEmptyString(evidence.sourceEventId);

  return {
    confidence: readConfidence(evidence.confidence),
    reason: readNonEmptyString(evidence.reason),
    matchedPattern: readNonEmptyString(evidence.matchedPattern),
    sourceEventId,
    sessionId: readNonEmptyString(evidence.sessionId),
  };
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function formatEvidenceWhyStored(
  memoryType: DurableMemoryType,
  evidence: NormalizedDurableEvidence,
): string {
  const parts: string[] = [`Stored as ${memoryType}`];

  if (evidence.matchedPattern) {
    parts.push(`because matched "${evidence.matchedPattern}"`);
  } else if (evidence.reason) {
    parts.push(`because ${evidence.reason}`);
  }

  if (typeof evidence.confidence === 'number') {
    parts.push(`with ${formatConfidence(evidence.confidence)}`);
  }

  if (evidence.sessionId) {
    parts.push(`from session ${evidence.sessionId}`);
  } else if (evidence.sourceEventId) {
    parts.push(`from event ${evidence.sourceEventId}`);
  }

  return `${parts.join(' ')}.`;
}
