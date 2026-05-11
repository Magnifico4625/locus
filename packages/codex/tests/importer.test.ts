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

function readInboxEvents(inboxDir: string): Array<{
  kind: string;
  session_id: string;
  payload: Record<string, unknown>;
}> {
  return readdirSync(inboxDir)
    .filter((name) => name.endsWith('.json'))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(inboxDir, name), 'utf-8')) as {
          kind: string;
          session_id: string;
          timestamp: number;
          payload: Record<string, unknown>;
        },
    )
    .sort((a, b) => a.timestamp - b.timestamp || a.kind.localeCompare(b.kind))
    .map(({ kind, session_id, payload }) => ({ kind, session_id, payload }));
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

  it('keeps metadata mode minimal even for high-signal decision sessions', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'decision-session.jsonl', 'rollout-decision.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'metadata' });

    expect(metrics).toEqual({
      filesScanned: 1,
      recordsParsed: 4,
      parseErrors: 0,
      normalized: 4,
      written: 2,
      duplicatePending: 0,
      skippedUnknown: 0,
      skippedByCapture: 2,
      skippedByFilter: 0,
      errors: 0,
      latestSession: 'sess_decision_001',
    });
    expect(readInboxKinds(inboxDir)).toEqual(['session_end', 'session_start']);
  });

  it('filters noisy chatter in redacted mode but keeps bounded useful decision context', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'noisy-session.jsonl', 'rollout-noisy.jsonl');
    copyFixtureAsRollout(sessionsDir, 'decision-session.jsonl', 'rollout-decision.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'redacted' });
    const events = readInboxEvents(inboxDir);

    expect(metrics).toEqual({
      filesScanned: 2,
      recordsParsed: 8,
      parseErrors: 0,
      normalized: 8,
      written: 6,
      duplicatePending: 0,
      skippedUnknown: 0,
      skippedByCapture: 2,
      skippedByFilter: 0,
      errors: 0,
      latestSession: 'sess_decision_001',
    });
    expect(events.map((event) => `${event.session_id}:${event.kind}`)).toEqual([
      'sess_noisy_001:session_start',
      'sess_noisy_001:session_end',
      'sess_decision_001:session_start',
      'sess_decision_001:user_prompt',
      'sess_decision_001:ai_response',
      'sess_decision_001:session_end',
    ]);
    expect(events[3]?.payload).toMatchObject({
      prompt: 'The parser crashes on empty input after the nullable-branch refactor. ...',
      capture_policy: 'bounded_redacted',
      capture_reason: 'preference',
      truncated: true,
    });
    expect(events[4]?.payload).toMatchObject({
      capture_policy: 'bounded_redacted',
      capture_reason: 'next_step',
      truncated: false,
    });
  });

  it('retains richer redacted v2 recall context while dropping noise and redacting secrets', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });

    writeRollout(sessionsDir, 'rollout-redacted-v2.jsonl', [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-07T09:00:00.000Z',
        session_id: 'sess_redacted_v2_001',
        cwd: 'C:\\Projects\\SampleApp',
        model: 'gpt-5.4',
      }),
      JSON.stringify({
        type: 'event_msg',
        subtype: 'user_message',
        timestamp: '2026-05-07T09:00:01.000Z',
        message: 'Решили использовать SQLite cache для live recall в Codex CLI.',
      }),
      JSON.stringify({
        type: 'event_msg',
        subtype: 'user_message',
        timestamp: '2026-05-07T09:00:02.000Z',
        message: 'Отказались от hook-first capture, потому что это риск для стабильного релиза.',
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-05-07T09:00:03.000Z',
        item: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Validation passed: npm test -- packages/codex/tests/relevance.test.ts and npm -w @locus/codex run typecheck are green.',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        subtype: 'user_message',
        timestamp: '2026-05-07T09:00:04.000Z',
        message: 'Что такое монады в функциональном программировании?',
      }),
      JSON.stringify({
        type: 'event_msg',
        subtype: 'user_message',
        timestamp: '2026-05-07T09:00:05.000Z',
        message:
          'Bug: recall importer failed with Authorization: Bearer safeexampletoken123 and GITHUB_TOKEN=ghp_safeexampletoken1234567890.',
      }),
    ]);

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'redacted' });
    const events = readInboxEvents(inboxDir);

    expect(metrics).toMatchObject({
      filesScanned: 1,
      recordsParsed: 6,
      normalized: 6,
      written: 5,
      skippedByCapture: 1,
      errors: 0,
      latestSession: 'sess_redacted_v2_001',
    });
    expect(events.map((event) => event.kind)).toEqual([
      'session_start',
      'user_prompt',
      'user_prompt',
      'ai_response',
      'user_prompt',
    ]);

    const decision = events.find((event) =>
      typeof event.payload.prompt === 'string'
        ? event.payload.prompt.includes('SQLite cache')
        : false,
    );
    expect(decision?.payload).toMatchObject({
      capture_policy: 'bounded_redacted',
      capture_reason: 'decision',
      redaction_applied: false,
      truncated: false,
    });

    const rejected = events.find((event) =>
      typeof event.payload.prompt === 'string'
        ? event.payload.prompt.includes('hook-first capture')
        : false,
    );
    expect(rejected?.payload).toMatchObject({
      capture_policy: 'bounded_redacted',
      capture_reason: 'rejected_alternative',
      redaction_applied: false,
      truncated: false,
    });

    const validation = events.find((event) => event.kind === 'ai_response');
    expect(validation?.payload).toMatchObject({
      capture_policy: 'bounded_redacted',
      capture_reason: 'validation_fact',
      redaction_applied: false,
      truncated: false,
    });
    expect(validation?.payload.response).toContain('Validation passed');

    const secret = events.find((event) =>
      typeof event.payload.prompt === 'string'
        ? event.payload.prompt.includes('recall importer failed')
        : false,
    );
    expect(secret?.payload).toMatchObject({
      capture_policy: 'bounded_redacted',
      capture_reason: 'bug_context',
      redaction_applied: true,
    });
    expect(secret?.payload.prompt).toContain('Bearer [REDACTED]');
    expect(secret?.payload.prompt).not.toContain('safeexampletoken123');
    expect(secret?.payload.prompt).not.toContain('ghp_safeexampletoken1234567890');

    expect(JSON.stringify(events)).not.toContain('монады');
  });

  it('keeps full decision text without bounded payload metadata in full mode', () => {
    const root = tempRoot();
    const sessionsDir = join(root, 'sessions');
    const inboxDir = join(root, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureAsRollout(sessionsDir, 'decision-session.jsonl', 'rollout-decision.jsonl');

    const metrics = importCodexSessionsToInbox({ sessionsDir, inboxDir, captureMode: 'full' });
    const events = readInboxEvents(inboxDir);
    const prompt = events.find((event) => event.kind === 'user_prompt');
    const response = events.find((event) => event.kind === 'ai_response');

    expect(metrics).toEqual({
      filesScanned: 1,
      recordsParsed: 4,
      parseErrors: 0,
      normalized: 4,
      written: 4,
      duplicatePending: 0,
      skippedUnknown: 0,
      skippedByCapture: 0,
      skippedByFilter: 0,
      errors: 0,
      latestSession: 'sess_decision_001',
    });
    expect(prompt?.payload).toEqual({
      prompt:
        'The parser crashes on empty input after the nullable-branch refactor. Keep the fix surgical and avoid touching unrelated modules.',
    });
    expect(response?.payload).toEqual({
      response:
        'I traced the failure to parseNullableBranch. Next I will add a failing regression test and keep the patch inside the parser module.',
      model: 'gpt-5.4',
    });
  });
});
