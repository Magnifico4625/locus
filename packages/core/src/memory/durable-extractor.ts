import type { ConversationEventRow, DurableMemoryEntry, DurableMemoryType } from '../types.js';
import { extractPatternMatches, type ExtractorPatternMatch } from './extractor-patterns.js';
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

function buildCandidate(
  event: ConversationEventRow,
  match: ExtractorPatternMatch,
): DurableMemoryCandidate {
  return {
    topicKey: deriveTopicKey({ memoryType: match.memoryType, summary: match.summary }),
    memoryType: match.memoryType,
    summary: match.summary,
    evidence: {
      eventId: event.event_id,
      kind: event.kind,
      timestamp: event.timestamp,
      sessionId: event.session_id ?? undefined,
      matchedPattern: match.matchedPattern,
      confidence: match.confidence,
      reason: match.reason,
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

  for (const text of [summaryText, promptText, responseText]) {
    if (!text) {
      continue;
    }

    for (const match of extractPatternMatches(text)) {
      if (!candidates.some((candidate) => candidate.memoryType === match.memoryType)) {
        candidates.push(buildCandidate(event, match));
      }
    }
  }

  return candidates;
}
