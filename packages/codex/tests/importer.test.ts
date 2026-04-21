import {
  cpSync,
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
import { importCodexSessionsToInbox } from '../src/importer.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-codex-importer-'));
  tempRoots.push(dir);
  return dir;
}

function copyFixtureAsRollout(
  sessionsDir: string,
  fixtureName: string,
  rolloutName: string,
): string {
  const target = join(sessionsDir, rolloutName);
  cpSync(join(fixturesDir, fixtureName), target);
  return target;
}

function writeRollout(sessionsDir: string, rolloutName: string, lines: string[]): string {
  const target = join(sessionsDir, rolloutName);
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8');
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
      skippedByFilter: 0,
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
      skippedByFilter: 0,
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

  it('imports only the newest rollout file when latestOnly=true', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-001.jsonl');
    copyFixtureAsRollout(sessionsDir, 'tool-session.jsonl', 'rollout-002.jsonl');

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
      latestOnly: true,
    });

    expect(metrics.filesScanned).toBe(1);
    expect(metrics.recordsParsed).toBe(4);
    expect(metrics.normalized).toBe(4);
    expect(metrics.written).toBe(4);
    expect(metrics.latestSession).toBe('sess_tool_001');
    expect(readInboxKinds(inboxDir)).toEqual(['session_start', 'tool_use', 'tool_use', 'tool_use']);
  });

  it('keeps only events for the requested sessionId', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');
    copyFixtureAsRollout(sessionsDir, 'tool-session.jsonl', 'rollout-tool.jsonl');

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
      sessionId: 'sess_basic_001',
    });

    expect(metrics.written).toBe(4);
    expect(metrics.skippedByFilter).toBe(4);
    expect(metrics.latestSession).toBe('sess_basic_001');
    expect(readInboxKinds(inboxDir)).toEqual([
      'ai_response',
      'session_end',
      'session_start',
      'user_prompt',
    ]);
  });

  it('ignores events older than since timestamp', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');
    copyFixtureAsRollout(sessionsDir, 'tool-session.jsonl', 'rollout-tool.jsonl');

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
      since: Date.parse('2026-04-10T08:30:00.000Z'),
    });

    expect(metrics.written).toBe(4);
    expect(metrics.skippedByFilter).toBe(4);
    expect(metrics.latestSession).toBe('sess_tool_001');
    expect(readInboxKinds(inboxDir)).toEqual(['session_start', 'tool_use', 'tool_use', 'tool_use']);
  });

  it('filters out events whose projectRoot does not match', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });

    writeRollout(sessionsDir, 'rollout-other-project.jsonl', [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-10T10:00:00.000Z',
        session_id: 'sess_other_001',
        cwd: 'C:\\Projects\\OtherApp',
        model: 'gpt-5.4',
      }),
      JSON.stringify({
        type: 'event_msg',
        subtype: 'user_message',
        timestamp: '2026-04-10T10:00:01.000Z',
        message: 'This should be filtered out',
      }),
    ]);

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
      projectRoot: 'C:\\Projects\\SampleApp',
    });

    expect(metrics.filesScanned).toBe(1);
    expect(metrics.written).toBe(0);
    expect(metrics.skippedByFilter).toBe(2);
    expect(metrics.latestSession).toBeUndefined();
    expect(existsSync(inboxDir)).toBe(false);
  });

  it('tracks latestSession by max event timestamp across all scanned files', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });

    writeRollout(sessionsDir, 'rollout-a-new.jsonl', [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-10T12:00:00.000Z',
        session_id: 'sess_new_001',
        cwd: 'C:\\Projects\\SampleApp',
        model: 'gpt-5.4',
      }),
    ]);

    writeRollout(sessionsDir, 'rollout-z-old.jsonl', [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-10T07:00:00.000Z',
        session_id: 'sess_old_001',
        cwd: 'C:\\Projects\\SampleApp',
        model: 'gpt-5.4',
      }),
    ]);

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
    });

    expect(metrics.filesScanned).toBe(2);
    expect(metrics.written).toBe(2);
    expect(metrics.latestSession).toBe('sess_new_001');
  });

  it('counts shouldSkipEventId matches as duplicates without writing inbox files', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'basic-session.jsonl', 'rollout-basic.jsonl');

    const metrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
      shouldSkipEventId: () => true,
    });

    expect(metrics.written).toBe(0);
    expect(metrics.duplicatePending).toBe(4);
    expect(metrics.latestSession).toBe('sess_basic_001');
    expect(existsSync(inboxDir)).toBe(false);
  });

  it('imports the new sanitized noisy and decision fixtures without parse errors', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'noisy-session.jsonl', 'rollout-noisy.jsonl');
    copyFixtureAsRollout(sessionsDir, 'decision-session.jsonl', 'rollout-decision.jsonl');

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
      skippedByFilter: 0,
      errors: 0,
      latestSession: 'sess_decision_001',
    });
    expect(readInboxKinds(inboxDir)).toEqual([
      'ai_response',
      'ai_response',
      'session_end',
      'session_end',
      'session_start',
      'session_start',
      'user_prompt',
      'user_prompt',
    ]);
  });
});
