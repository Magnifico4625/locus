import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocusInboxEventV1 } from '../src/inbox-event.js';
import { writeCodexInboxEvent } from '../src/inbox-writer.js';

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-inbox-'));
  tempRoots.push(dir);
  return dir;
}

function makeEvent(overrides: Partial<LocusInboxEventV1> = {}): LocusInboxEventV1 {
  return {
    version: 1,
    event_id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    source: 'codex',
    source_event_id: 'codex:sess_1:rollout.jsonl:1:session_start:no-item',
    project_root: 'C:\\Projects\\SampleApp',
    session_id: 'sess_1',
    timestamp: 1770000000000,
    kind: 'session_start',
    payload: { tool: 'codex', model: 'gpt-5.4' },
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeCodexInboxEvent', () => {
  it('creates the inbox directory and writes the event to the final filename', () => {
    const inboxDir = join(tempRoot(), 'nested', 'inbox');
    const event = makeEvent();

    const result = writeCodexInboxEvent(inboxDir, event);

    expect(result).toEqual({
      status: 'written',
      filename: '1770000000000-abcdef12.json',
    });
    expect(existsSync(inboxDir)).toBe(true);
    expect(JSON.parse(readFileSync(join(inboxDir, result.filename), 'utf-8'))).toEqual(event);
  });

  it('uses the filename rule timestamp-eventIdPrefix.json', () => {
    const inboxDir = tempRoot();
    const event = makeEvent({
      event_id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timestamp: 1770000000123,
    });

    expect(writeCodexInboxEvent(inboxDir, event).filename).toBe('1770000000123-12345678.json');
  });

  it('renames through a tmp file without leaving tmp files behind', () => {
    const inboxDir = tempRoot();

    writeCodexInboxEvent(inboxDir, makeEvent());

    expect(readdirSync(inboxDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(readdirSync(inboxDir)).toEqual(['1770000000000-abcdef12.json']);
  });

  it('skips duplicate pending files and does not overwrite existing content', () => {
    const inboxDir = tempRoot();
    mkdirSync(inboxDir, { recursive: true });
    const filename = '1770000000000-abcdef12.json';
    const finalPath = join(inboxDir, filename);
    writeFileSync(finalPath, '{"existing":true}', 'utf-8');

    const result = writeCodexInboxEvent(inboxDir, makeEvent({ payload: { tool: 'new' } }));

    expect(result).toEqual({ status: 'duplicate_pending', filename });
    expect(readFileSync(finalPath, 'utf-8')).toBe('{"existing":true}');
    expect(readdirSync(inboxDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
