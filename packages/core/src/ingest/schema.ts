import { z } from 'zod';
import type { EventKind, InboxEvent } from '../types.js';

const eventKinds: [EventKind, ...EventKind[]] = [
  'user_prompt',
  'ai_response',
  'tool_use',
  'file_diff',
  'session_start',
  'session_end',
];

const inboxEventSchema = z.object({
  version: z.literal(1),
  event_id: z.string().min(1),
  source: z.string().min(1),
  source_event_id: z.string().optional(),
  project_root: z.string().min(1),
  session_id: z.string().optional(),
  timestamp: z.number().int().positive(),
  kind: z.enum(eventKinds),
  payload: z.record(z.string(), z.unknown()),
});

/**
 * Validates raw JSON against the InboxEvent v1 schema.
 * Returns a typed InboxEvent on success, null on failure.
 * Never throws — callers can safely use in pipeline without try/catch.
 */
export function validateInboxEvent(json: unknown): InboxEvent | null {
  const result = inboxEventSchema.safeParse(json);
  return result.success ? (result.data as InboxEvent) : null;
}
