import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeInboxEvent } from '../../src/ingest/inbox-writer.js';
import type { InboxEvent } from '../../src/types.js';

function makeEvent(overrides?: Partial<InboxEvent>): InboxEvent {
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

describe('writeInboxEvent', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-inbox-writer-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes valid JSON that can be parsed back to original event', () => {
    const event = makeEvent();
    const filename = writeInboxEvent(tempDir, event);
    const filePath = join(tempDir, filename);
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as InboxEvent;

    expect(parsed.version).toBe(1);
    expect(parsed.event_id).toBe(event.event_id);
    expect(parsed.source).toBe('claude-code');
    expect(parsed.kind).toBe('tool_use');
    expect(parsed.timestamp).toBe(1708876543210);
    expect(parsed.payload).toEqual({ tool: 'Bash', files: [], status: 'success' });
  });

  it('leaves no .tmp files after successful write', () => {
    const event = makeEvent();
    writeInboxEvent(tempDir, event);

    const files = readdirSync(tempDir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('returns filename matching {timestamp}-{event_id_short}.json pattern', () => {
    const event = makeEvent({
      timestamp: 1708876543210,
      event_id: 'a1b2c3d4-5678-9abc-def0-1234567890ab',
    });
    const filename = writeInboxEvent(tempDir, event);

    expect(filename).toBe('1708876543210-a1b2c3d4.json');
    expect(filename).toMatch(/^\d+-[a-f0-9]{8}\.json$/);
  });

  it('creates inbox directory if it does not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'inbox');
    const event = makeEvent();
    const filename = writeInboxEvent(nestedDir, event);

    const files = readdirSync(nestedDir);
    expect(files).toContain(filename);
  });

  it('handles multiple writes without collision', () => {
    const event1 = makeEvent({
      event_id: 'aaaaaaaa-1111-1111-1111-111111111111',
      timestamp: 1000000000000,
    });
    const event2 = makeEvent({
      event_id: 'bbbbbbbb-2222-2222-2222-222222222222',
      timestamp: 1000000000001,
    });

    const file1 = writeInboxEvent(tempDir, event1);
    const file2 = writeInboxEvent(tempDir, event2);

    expect(file1).not.toBe(file2);

    const files = readdirSync(tempDir);
    expect(files).toHaveLength(2);
    expect(files).toContain(file1);
    expect(files).toContain(file2);
  });
});
