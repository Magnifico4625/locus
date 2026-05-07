import { describe, expect, it } from 'vitest';
import {
  captureCodexEvent,
  redactCodexText,
  redactCodexTextWithMetadata,
} from '../src/capture.js';
import type { CodexNormalizedEvent } from '../src/types.js';

function event(payload: Record<string, unknown>, kind: CodexNormalizedEvent['kind']): CodexNormalizedEvent {
  return {
    kind,
    timestamp: Date.parse('2026-05-07T10:00:00.000Z'),
    sessionId: 'sess-redaction',
    projectRoot: 'C:\\Projects\\SampleApp',
    sourceFile: 'inline.jsonl',
    sourceLine: 1,
    payload,
  };
}

describe('redactCodexText v2', () => {
  it('redacts common token and secret shapes as best effort', () => {
    const input = [
      'Authorization: Bearer safeexampletoken123',
      'OPENAI_API_KEY=sk-safeexample1234567890',
      '//registry.npmjs.org/:_authToken=npm_safeexampletoken1234567890',
      'GITHUB_TOKEN=ghp_safeexampletoken1234567890',
      'password=plain-text-password',
      'api_key: plain-api-key-value',
      'normal text remains',
    ].join('\n');

    expect(redactCodexText(input)).toBe(
      [
        'Authorization: Bearer [REDACTED]',
        'OPENAI_API_KEY=[REDACTED]',
        '//registry.npmjs.org/:_authToken=[REDACTED]',
        'GITHUB_TOKEN=[REDACTED]',
        'password=[REDACTED]',
        'api_key: [REDACTED]',
        'normal text remains',
      ].join('\n'),
    );
  });

  it('redacts private key block bodies while keeping the marker visible', () => {
    const input = [
      'before',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'safeexamplekeybody',
      '-----END OPENSSH PRIVATE KEY-----',
      'after',
    ].join('\n');

    expect(redactCodexText(input)).toBe(
      ['before', '-----BEGIN OPENSSH PRIVATE KEY-----', '[REDACTED]', 'after'].join('\n'),
    );
  });

  it('returns redaction metadata when text changed', () => {
    expect(redactCodexTextWithMetadata('token=abc123')).toEqual({
      text: 'token=[REDACTED]',
      redactionApplied: true,
    });
    expect(redactCodexTextWithMetadata('normal text')).toEqual({
      text: 'normal text',
      redactionApplied: false,
    });
  });

  it('annotates retained redacted user prompts with redaction_applied', () => {
    const captured = captureCodexEvent(
      event(
        {
          prompt:
            'Bug: parser failed after refactor. Authorization: Bearer safeexampletoken123',
        },
        'user_prompt',
      ),
      'redacted',
    );

    expect(captured.event?.payload).toMatchObject({
      prompt: 'Bug: parser failed after refactor. Authorization: Bearer [REDACTED]',
      redactionApplied: true,
      captureReason: 'bug_context',
    });
  });

  it('annotates retained full assistant responses and session summaries', () => {
    const assistant = captureCodexEvent(
      event({ response: 'Fixed parser bug with token=abc123' }, 'ai_response'),
      'full',
    );
    const sessionEnd = captureCodexEvent(
      event({ summary: 'Validation passed with api_key: abc123' }, 'session_end'),
      'full',
    );

    expect(assistant.event?.payload).toMatchObject({
      response: 'Fixed parser bug with token=[REDACTED]',
      redactionApplied: true,
    });
    expect(sessionEnd.event?.payload).toMatchObject({
      summary: 'Validation passed with api_key: [REDACTED]',
      redactionApplied: true,
    });
  });
});
