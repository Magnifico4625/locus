import { describe, expect, it } from 'vitest';
import {
  getCodexCaptureMode,
  redactCodexText,
  shouldImportCodexEvent,
} from '../src/capture.js';
import type { CodexCaptureMode, CodexNormalizedKind } from '../src/types.js';

const allKinds: CodexNormalizedKind[] = [
  'session_start',
  'user_prompt',
  'ai_response',
  'tool_use',
  'session_end',
];

describe('getCodexCaptureMode', () => {
  it.each([
    ['off'],
    ['metadata'],
    ['redacted'],
    ['full'],
  ] satisfies [CodexCaptureMode][])('accepts %s', (mode) => {
    expect(getCodexCaptureMode({ LOCUS_CODEX_CAPTURE: mode })).toBe(mode);
  });

  it('defaults missing capture env to metadata', () => {
    expect(getCodexCaptureMode({})).toBe('metadata');
  });

  it('defaults invalid capture env to metadata', () => {
    expect(getCodexCaptureMode({ LOCUS_CODEX_CAPTURE: 'verbose' })).toBe('metadata');
  });
});

describe('shouldImportCodexEvent', () => {
  it('imports no events when capture mode is off', () => {
    expect(allKinds.map((kind) => shouldImportCodexEvent('off', kind))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('imports metadata-only events in metadata mode', () => {
    expect(allKinds.map((kind) => shouldImportCodexEvent('metadata', kind))).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('imports prompt and metadata events but skips assistant text in redacted mode', () => {
    expect(allKinds.map((kind) => shouldImportCodexEvent('redacted', kind))).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });

  it('imports all events in full mode', () => {
    expect(allKinds.map((kind) => shouldImportCodexEvent('full', kind))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('redactCodexText', () => {
  it('redacts obvious bearer tokens, sk keys, and secret-like assignments', () => {
    const input = [
      'Authorization: Bearer safeexampletoken123',
      'OPENAI_API_KEY=sk-safeexample1234567890',
      'password = "safe-password-value"',
      'token: safe-token-value',
      'normal text stays visible',
    ].join('\n');

    expect(redactCodexText(input)).toBe(
      [
        'Authorization: Bearer [REDACTED]',
        'OPENAI_API_KEY=[REDACTED]',
        'password = [REDACTED]',
        'token: [REDACTED]',
        'normal text stays visible',
      ].join('\n'),
    );
  });
});
