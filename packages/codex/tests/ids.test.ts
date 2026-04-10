import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCodexEventId, createCodexSourceEventId } from '../src/ids.js';

describe('Codex stable event identity', () => {
  it('creates stable source_event_id from session, file, line, kind, and item id', () => {
    const id = createCodexSourceEventId({
      sessionId: 'sess_1',
      filePath: 'C:\\Users\\Example\\.codex\\sessions\\rollout-2026-04-10.jsonl',
      line: 12,
      kind: 'tool_use',
      itemId: 'call_1',
    });

    expect(id).toBe('codex:sess_1:rollout-2026-04-10.jsonl:12:tool_use:call_1');
  });

  it('uses stable fallbacks for missing session and item ids', () => {
    const id = createCodexSourceEventId({
      filePath: '/home/example/.codex/sessions/rollout-a.jsonl',
      line: 1,
      kind: 'session_start',
    });

    expect(id).toBe('codex:unknown-session:rollout-a.jsonl:1:session_start:no-item');
  });

  it('creates deterministic SHA-256 event_id from source_event_id', () => {
    const sourceEventId = 'codex:sess_1:rollout.jsonl:1:session_start:no-item';
    const expected = createHash('sha256').update(sourceEventId).digest('hex');

    expect(createCodexEventId(sourceEventId)).toBe(expected);
    expect(createCodexEventId(sourceEventId)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes identity when line or item id changes', () => {
    const base = {
      sessionId: 'sess_1',
      filePath: 'rollout.jsonl',
      kind: 'tool_use',
    };

    const lineOne = createCodexSourceEventId({ ...base, line: 1, itemId: 'call_1' });
    const lineTwo = createCodexSourceEventId({ ...base, line: 2, itemId: 'call_1' });
    const itemTwo = createCodexSourceEventId({ ...base, line: 1, itemId: 'call_2' });

    expect(lineOne).not.toBe(lineTwo);
    expect(lineOne).not.toBe(itemTwo);
    expect(createCodexEventId(lineOne)).not.toBe(createCodexEventId(lineTwo));
    expect(createCodexEventId(lineOne)).not.toBe(createCodexEventId(itemTwo));
  });
});
