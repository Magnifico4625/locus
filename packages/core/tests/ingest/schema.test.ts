import { describe, expect, it } from 'vitest';
import { validateInboxEvent } from '../../src/ingest/schema.js';
import type { InboxEvent } from '../../src/types.js';

function makeValidEvent(overrides?: Partial<InboxEvent>): InboxEvent {
  return {
    version: 1,
    event_id: 'a1b2c3d4-5678-9abc-def0-1234567890ab',
    source: 'claude-code',
    project_root: '/home/user/myapp',
    timestamp: 1708876543210,
    kind: 'tool_use',
    payload: { tool: 'Bash', files: [], status: 'success' },
    ...overrides,
  };
}

describe('validateInboxEvent', () => {
  it('returns InboxEvent for valid event', () => {
    const input = makeValidEvent();
    const result = validateInboxEvent(input);
    expect(result).not.toBeNull();
    expect(result?.event_id).toBe('a1b2c3d4-5678-9abc-def0-1234567890ab');
    expect(result?.version).toBe(1);
    expect(result?.kind).toBe('tool_use');
    expect(result?.source).toBe('claude-code');
    expect(result?.timestamp).toBe(1708876543210);
  });

  it('accepts event with optional fields (session_id, source_event_id)', () => {
    const input = makeValidEvent({
      session_id: 'sess-123',
      source_event_id: 'src-evt-456',
    });
    const result = validateInboxEvent(input);
    expect(result).not.toBeNull();
    expect(result?.session_id).toBe('sess-123');
    expect(result?.source_event_id).toBe('src-evt-456');
  });

  it('accepts all valid event kinds', () => {
    const kinds = [
      'user_prompt',
      'ai_response',
      'tool_use',
      'file_diff',
      'session_start',
      'session_end',
    ] as const;
    for (const kind of kinds) {
      const result = validateInboxEvent(makeValidEvent({ kind }));
      expect(result).not.toBeNull();
      expect(result?.kind).toBe(kind);
    }
  });

  it('rejects missing version field', () => {
    const { version, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects wrong version (not 1)', () => {
    const input = { ...makeValidEvent(), version: 2 };
    expect(validateInboxEvent(input)).toBeNull();
  });

  it('rejects invalid kind', () => {
    const input = { ...makeValidEvent(), kind: 'bogus_kind' };
    expect(validateInboxEvent(input)).toBeNull();
  });

  it('rejects missing event_id', () => {
    const { event_id, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects empty event_id', () => {
    const input = makeValidEvent({ event_id: '' });
    expect(validateInboxEvent(input)).toBeNull();
  });

  it('rejects missing timestamp', () => {
    const { timestamp, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects missing kind', () => {
    const { kind, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects missing payload', () => {
    const { payload, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects missing source', () => {
    const { source, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects missing project_root', () => {
    const { project_root, ...rest } = makeValidEvent();
    expect(validateInboxEvent(rest)).toBeNull();
  });

  it('rejects non-object input (null)', () => {
    expect(validateInboxEvent(null)).toBeNull();
  });

  it('rejects non-object input (string)', () => {
    expect(validateInboxEvent('not an object')).toBeNull();
  });

  it('rejects non-object input (number)', () => {
    expect(validateInboxEvent(42)).toBeNull();
  });

  it('rejects non-object input (array)', () => {
    expect(validateInboxEvent([1, 2, 3])).toBeNull();
  });

  it('rejects non-integer timestamp', () => {
    const input = makeValidEvent({ timestamp: 1708876543.5 });
    expect(validateInboxEvent(input)).toBeNull();
  });

  it('rejects negative timestamp', () => {
    const input = makeValidEvent({ timestamp: -1 });
    expect(validateInboxEvent(input)).toBeNull();
  });
});
