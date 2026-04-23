import type { ConversationEventRow, DurableMemoryEntry, DurableMemoryType } from '../types.js';
import { deriveTopicKey } from './topic-keys.js';

export interface DurableMemoryCandidate {
  topicKey?: string;
  memoryType: DurableMemoryType;
  summary: string;
  evidence: Record<string, unknown>;
  sourceEventId?: string;
  source: DurableMemoryEntry['source'];
}

function parsePayload(payloadJson: string | null): Record<string, unknown> | undefined {
  if (!payloadJson) {
    return undefined;
  }

  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeSentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractDecisionSummary(text: string): string | undefined {
  const normalized = normalizeSentence(text);
  const match = normalized.match(/decision:\s*(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  if (/^use\s+/i.test(normalized)) {
    return normalized;
  }

  return undefined;
}

function extractStyleSummary(text: string): string | undefined {
  const normalized = normalizeSentence(text);
  const lower = normalized.toLowerCase();

  if (
    lower.includes('surgical') ||
    lower.includes('avoid unrelated refactors') ||
    lower.includes('prove it with tests')
  ) {
    return normalized;
  }

  return undefined;
}

function extractConstraintSummary(text: string): string | undefined {
  const normalized = normalizeSentence(text);
  const lower = normalized.toLowerCase();

  if (
    lower.includes('do not touch ') ||
    lower.includes('keep codex as the primary validation path')
  ) {
    return normalized;
  }

  return undefined;
}

function buildCandidate(
  event: ConversationEventRow,
  memoryType: DurableMemoryType,
  summary: string,
): DurableMemoryCandidate {
  return {
    topicKey: deriveTopicKey({ memoryType, summary }),
    memoryType,
    summary,
    evidence: {
      eventId: event.event_id,
      kind: event.kind,
      timestamp: event.timestamp,
      sessionId: event.session_id ?? undefined,
    },
    sourceEventId: event.event_id,
    source: event.source as DurableMemoryEntry['source'],
  };
}

export function extractDurableCandidatesFromEvent(
  event: ConversationEventRow,
): DurableMemoryCandidate[] {
  const payload = parsePayload(event.payload_json);
  if (!payload) {
    return [];
  }

  const candidates: DurableMemoryCandidate[] = [];

  const summaryText = typeof payload.summary === 'string' ? payload.summary : undefined;
  const promptText = typeof payload.prompt === 'string' ? payload.prompt : undefined;
  const responseText = typeof payload.response === 'string' ? payload.response : undefined;

  const decisionText = summaryText ?? responseText;
  const decisionSummary = decisionText ? extractDecisionSummary(decisionText) : undefined;
  if (decisionSummary) {
    candidates.push(buildCandidate(event, 'decision', decisionSummary));
  }

  const styleSummary = promptText ? extractStyleSummary(promptText) : undefined;
  if (styleSummary) {
    candidates.push(buildCandidate(event, 'style', styleSummary));
  }

  const constraintSummary = promptText ? extractConstraintSummary(promptText) : undefined;
  if (constraintSummary) {
    candidates.push(buildCandidate(event, 'constraint', constraintSummary));
  }

  return candidates;
}
