import { describe, expect, it } from 'vitest';
import { getCodexCaptureMode, shouldImportCodexEvent } from '../src/capture.js';
import { CODEX_CAPTURE_REASONS } from '../src/types.js';
import type { CodexCaptureMode, CodexCaptureReason, CodexNormalizedKind } from '../src/types.js';

const allKinds: CodexNormalizedKind[] = [
  'session_start',
  'user_prompt',
  'ai_response',
  'tool_use',
  'session_end',
];

describe('getCodexCaptureMode', () => {
  it.each([['off'], ['metadata'], ['redacted'], ['full']] satisfies [
    CodexCaptureMode,
  ][])('accepts %s', (mode) => {
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

  it('imports prompt, assistant, and metadata events in redacted mode for bounded filtering', () => {
    expect(allKinds.map((kind) => shouldImportCodexEvent('redacted', kind))).toEqual([
      true,
      true,
      true,
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

describe('CodexCaptureReason contract', () => {
  it('exposes all Track C capture reasons as a runtime contract', () => {
    const expectedReasons: CodexCaptureReason[] = [
      'noise',
      'bug_context',
      'decision',
      'preference',
      'style',
      'constraint',
      'rejected_alternative',
      'validation_fact',
      'release_context',
      'next_step',
      'general_context',
    ];

    expect(CODEX_CAPTURE_REASONS).toEqual(expectedReasons);
  });
});
