import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importCodexSessionsToInbox } from '../src/importer.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-importer-'));
  tempRoots.push(dir);
  return dir;
}

function copyFixtureAsRollout(sessionsDir: string, fixtureName: string, rolloutName: string): string {
  const target = join(sessionsDir, rolloutName);
  cpSync(join(fixturesDir, fixtureName), target);
  return target;
}

function readInboxKinds(inboxDir: string): string[] {
  return readdirSync(inboxDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(inboxDir, name), 'utf-8')) as { kind: string })
    .map((event) => event.kind)
    .sort();
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('importCodexSessionsToInbox', () => {
  it('imports fixture sessions into a temp inbox in full capture mode', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');
    copyFixtureAsRollout(sessionsDir, 'tool-session.jsonl', 'rollout-tool.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'full' });

    expect(metrics).toEqual({
      filesScanned: 2,
      recordsParsed: 8,
      parseErrors: 0,
      normalized: 8,
      written: 8,
      duplicatePending: 0,
      skippedUnknown: 0,
      skippedByCapture: 0,
      errors: 0,
      latestSession: 'sess_tool_001',
    });
    expect(readInboxKinds(inboxDir)).toEqual([
      'ai_response',
      'session_end',
      'session_start',
      'session_start',
      'tool_use',
      'tool_use',
      'tool_use',
      'user_prompt',
    ]);
  });

  it('writes only structural events in metadata capture mode', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'metadata' });

    expect(metrics.written).toBe(2);
    expect(metrics.skippedByCapture).toBe(2);
    expect(readInboxKinds(inboxDir)).toEqual(['session_end', 'session_start']);
  });

  it('counts malformed and unknown records without stopping the import', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'malformed-lines.jsonl', 'rollout-malformed.jsonl');
    copyFixtureAsRollout(sessionsDir, 'unknown-records.jsonl', 'rollout-unknown.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'full' });

    expect(metrics.filesScanned).toBe(2);
    expect(metrics.recordsParsed).toBe(6);
    expect(metrics.parseErrors).toBe(2);
    expect(metrics.normalized).toBe(3);
    expect(metrics.written).toBe(3);
    expect(metrics.skippedUnknown).toBe(3);
    expect(metrics.errors).toBe(0);
    expect(readInboxKinds(inboxDir)).toEqual(['session_end', 'session_start', 'user_prompt']);
  });

  it('returns zero metrics for a missing sessions directory', () => {
    const root = tempRoot();
    const inboxDir = join(root, 'inbox');

    const metrics = importCodexSessionsToInbox({
      sessionsDir: join(root, 'missing-sessions'),
      inboxDir,
      captureMode: 'full',
    });

    expect(metrics).toEqual({
      filesScanned: 0,
      recordsParsed: 0,
      parseErrors: 0,
      normalized: 0,
      written: 0,
      duplicatePending: 0,
      skippedUnknown: 0,
      skippedByCapture: 0,
      errors: 0,
      latestSession: undefined,
    });
    expect(existsSync(inboxDir)).toBe(false);
  });

  it('reports duplicate pending files when importing the same sessions twice', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');

    const first = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'full' });
    const second = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'full' });

    expect(first.written).toBe(4);
    expect(first.duplicatePending).toBe(0);
    expect(second.written).toBe(0);
    expect(second.duplicatePending).toBe(4);
  });
});
