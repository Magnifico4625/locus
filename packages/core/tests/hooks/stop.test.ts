import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─── Transcript parsing helpers ──────────────────────────────────────────────

describe('parseTranscriptLines', () => {
  it('extracts assistant text from JSONL lines', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({ type: 'human', message: { content: 'Hello' } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hi there!' }] },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hi there!');
    expect(result[0].role).toBe('assistant');
  });

  it('extracts plain string content from assistant messages', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: 'Direct string response' },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Direct string response');
  });

  it('concatenates multiple text blocks in assistant message', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Part 1. ' },
            { type: 'text', text: 'Part 2.' },
          ],
        },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Part 1. Part 2.');
  });

  it('skips non-assistant messages', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({ type: 'human', message: { content: 'User prompt' } }),
      JSON.stringify({ type: 'tool_use', message: { content: 'tool call' } }),
      JSON.stringify({ type: 'tool_result', message: { content: 'result' } }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(0);
  });

  it('skips malformed JSONL lines without crashing', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      'not valid json at all',
      '{ broken json',
      JSON.stringify({
        type: 'assistant',
        message: { content: 'Valid response' },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Valid response');
  });

  it('returns empty array for empty input', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const result = parseTranscriptLines([]);
    expect(result).toHaveLength(0);
  });

  it('extracts model from assistant message if present', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: 'Response', model: 'claude-opus-4-6' },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('claude-opus-4-6');
  });

  it('skips assistant messages with empty content', async () => {
    const { parseTranscriptLines } = await import('../../../claude-code/hooks/stop.js');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: '' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [] },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result).toHaveLength(0);
  });
});

// ─── Tailer state management ─────────────────────────────────────────────────

describe('tailer state management', () => {
  const cleanupDirs: string[] = [];

  afterAll(() => {
    for (const dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it('loadTailerState returns 0 for unknown session', async () => {
    const { loadTailerState } = await import('../../../claude-code/hooks/stop.js');
    const stateDir = join(tmpdir(), `locus-test-tailer-${Date.now()}`);
    cleanupDirs.push(stateDir);
    const offset = loadTailerState(stateDir, 'nonexistent-session');
    expect(offset).toBe(0);
  });

  it('saveTailerState persists and loadTailerState reads back', async () => {
    const { loadTailerState, saveTailerState } = await import('../../../claude-code/hooks/stop.js');
    const stateDir = join(tmpdir(), `locus-test-tailer-rw-${Date.now()}`);
    cleanupDirs.push(stateDir);
    mkdirSync(stateDir, { recursive: true });

    saveTailerState(stateDir, 'session-123', 4096);
    const offset = loadTailerState(stateDir, 'session-123');
    expect(offset).toBe(4096);
  });

  it('saveTailerState creates state file if missing', async () => {
    const { saveTailerState } = await import('../../../claude-code/hooks/stop.js');
    const stateDir = join(tmpdir(), `locus-test-tailer-create-${Date.now()}`);
    cleanupDirs.push(stateDir);

    saveTailerState(stateDir, 'new-session', 1024);
    const statePath = join(stateDir, 'tailer-state.json');
    const content = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(content['new-session']).toBe(1024);
  });

  it('saveTailerState preserves other sessions', async () => {
    const { loadTailerState, saveTailerState } = await import('../../../claude-code/hooks/stop.js');
    const stateDir = join(tmpdir(), `locus-test-tailer-multi-${Date.now()}`);
    cleanupDirs.push(stateDir);
    mkdirSync(stateDir, { recursive: true });

    saveTailerState(stateDir, 'session-a', 100);
    saveTailerState(stateDir, 'session-b', 200);

    expect(loadTailerState(stateDir, 'session-a')).toBe(100);
    expect(loadTailerState(stateDir, 'session-b')).toBe(200);
  });
});

// ─── Stop hook (default export) ──────────────────────────────────────────────

describe('stop hook', () => {
  const cleanupDirs: string[] = [];
  let testDir: string;
  let originalStorageRoot: string | undefined;

  beforeEach(() => {
    originalStorageRoot = process.env.LOCUS_STORAGE_ROOT;
    testDir = join(
      tmpdir(),
      `locus-test-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testDir, { recursive: true });
    process.env.LOCUS_STORAGE_ROOT = join(testDir, 'storage');
    cleanupDirs.push(testDir);
  });

  afterEach(() => {
    if (originalStorageRoot === undefined) {
      delete process.env.LOCUS_STORAGE_ROOT;
    } else {
      process.env.LOCUS_STORAGE_ROOT = originalStorageRoot;
    }
  });

  afterAll(() => {
    for (const dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it('writes ai_response event at captureLevel=full', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, computeLocusDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      // Use explicit cwd to avoid env var interference in parallel test runs
      const explicitCwd = process.cwd();
      const projectRoot = resolveProjectRoot(explicitCwd);
      const inboxDir = computeInboxDir(projectRoot);
      const _locusDir = computeLocusDir(projectRoot);
      cleanupDirs.push(inboxDir);

      // Use unique session_id to avoid stale tailer-state from previous runs
      const uniqueSessionId = `stop-full-${Date.now()}`;

      // Create a fake transcript file
      const transcriptPath = join(testDir, 'transcript.jsonl');
      const lines = [
        JSON.stringify({ type: 'human', message: { content: 'Hello' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello! How can I help?' }],
            model: 'claude-opus-4-6',
          },
        }),
      ];
      writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf-8');

      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      let found = false;
      for (const file of files) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'ai_response' && content.session_id === uniqueSessionId) {
          expect(content.version).toBe(1);
          expect(content.source).toBe('claude-code');
          expect(content.payload.response).toBe('Hello! How can I help?');
          expect(content.payload.model).toBe('claude-opus-4-6');
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('does NOT write at captureLevel=metadata', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'metadata';

      const transcriptPath = join(testDir, 'transcript-skip.jsonl');
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: 'assistant',
          message: { content: 'Should not be captured' },
        })}\n`,
        'utf-8',
      );

      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      let filesBefore: string[] = [];
      try {
        filesBefore = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // inbox may not exist
      }

      await stop({
        session_id: 'stop-skip-session',
        transcript_path: transcriptPath,
      });

      let filesAfter: string[] = [];
      try {
        filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // inbox may not exist
      }

      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        expect(content.kind).not.toBe('ai_response');
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('does NOT write ai_response at captureLevel=redacted', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'redacted';

      const transcriptPath = join(testDir, 'transcript-redacted.jsonl');
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: 'assistant',
          message: { content: 'This response should not be captured at redacted level' },
        })}\n`,
        'utf-8',
      );

      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      let filesBefore: string[] = [];
      try {
        filesBefore = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // inbox may not exist
      }

      await stop({
        session_id: 'stop-redacted-session',
        transcript_path: transcriptPath,
      });

      let filesAfter: string[] = [];
      try {
        filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // inbox may not exist
      }

      // No new ai_response files should have been created
      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        expect(content.kind).not.toBe('ai_response');
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('handles missing transcript_path gracefully', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';
      const result = await stop({ session_id: 'no-transcript' });
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('handles nonexistent transcript file gracefully', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';
      const result = await stop({
        session_id: 'missing-file',
        transcript_path: join(testDir, 'does-not-exist.jsonl'),
      });
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('uses session cursor to read only new lines', async () => {
    const { default: stop, loadTailerState } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, computeLocusDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      // Use explicit cwd to avoid env var interference in parallel test runs
      const explicitCwd = process.cwd();
      const projectRoot = resolveProjectRoot(explicitCwd);
      const inboxDir = computeInboxDir(projectRoot);
      const locusDir = computeLocusDir(projectRoot);
      cleanupDirs.push(inboxDir);
      cleanupDirs.push(locusDir);

      // Use unique session_id to avoid stale tailer-state from previous runs
      const uniqueSessionId = `cursor-${Date.now()}`;

      // Create a transcript with an initial assistant message
      const transcriptPath = join(testDir, 'transcript-cursor.jsonl');
      const line1 = `${JSON.stringify({
        type: 'assistant',
        message: { content: 'First response' },
      })}\n`;
      writeFileSync(transcriptPath, line1, 'utf-8');

      // First call processes line1
      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      // Verify tailer state was updated
      const offset = loadTailerState(locusDir, uniqueSessionId);
      expect(offset).toBeGreaterThan(0);

      // Now append a second line
      const line2 = `${JSON.stringify({
        type: 'assistant',
        message: { content: 'Second response' },
      })}\n`;
      writeFileSync(transcriptPath, line1 + line2, 'utf-8');

      // Count files before second call
      const filesBefore = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));

      // Second call should only process line2
      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      const filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));

      // Should have exactly 1 new file for the second response
      const aiResponseFiles = [];
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'ai_response') {
          aiResponseFiles.push(content);
        }
      }
      expect(aiResponseFiles).toHaveLength(1);
      expect(aiResponseFiles[0].payload.response).toBe('Second response');
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('never crashes on null event', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive null handling
    const result = await stop(null as any);
    expect(result).toBeUndefined();
  });

  it('never crashes on undefined event', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    const result = await stop(undefined as any);
    expect(result).toBeUndefined();
  });

  it('handles empty transcript file', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';
      const transcriptPath = join(testDir, 'empty-transcript.jsonl');
      writeFileSync(transcriptPath, '', 'utf-8');

      const result = await stop({
        session_id: 'empty-transcript-session',
        transcript_path: transcriptPath,
      });
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('handles Cyrillic (2-byte UTF-8) correctly with byte offset', async () => {
    const { default: stop, loadTailerState } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, computeLocusDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      const explicitCwd = process.cwd();
      const projectRoot = resolveProjectRoot(explicitCwd);
      const inboxDir = computeInboxDir(projectRoot);
      const locusDir = computeLocusDir(projectRoot);
      cleanupDirs.push(inboxDir);
      cleanupDirs.push(locusDir);

      const uniqueSessionId = `cyrillic-${Date.now()}`;
      const transcriptPath = join(testDir, 'transcript-cyrillic.jsonl');

      // "Привет мир" is 10 chars but 19 bytes in UTF-8 (Cyrillic = 2 bytes per char)
      const line1 = `${JSON.stringify({
        type: 'assistant',
        message: { content: 'Привет мир — первый ответ' },
      })}\n`;
      writeFileSync(transcriptPath, line1, 'utf-8');

      // First call
      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      // Verify offset is saved as byte count, not char count
      const offset = loadTailerState(locusDir, uniqueSessionId);
      const byteLength = Buffer.byteLength(line1, 'utf-8');
      expect(offset).toBe(byteLength);

      // Append a second Cyrillic line
      const line2 = `${JSON.stringify({
        type: 'assistant',
        message: { content: 'Второй ответ с кириллицей' },
      })}\n`;
      writeFileSync(transcriptPath, line1 + line2, 'utf-8');

      // Count files before second call
      const filesBefore = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));

      // Second call should correctly read only line2
      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      const filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));

      // Find the new ai_response event
      const aiResponseFiles = [];
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'ai_response' && content.session_id === uniqueSessionId) {
          aiResponseFiles.push(content);
        }
      }
      expect(aiResponseFiles).toHaveLength(1);
      expect(aiResponseFiles[0].payload.response).toContain('Второй ответ');
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('handles emoji (4-byte UTF-8) correctly with byte offset', async () => {
    const { default: stop, loadTailerState } = await import('../../../claude-code/hooks/stop.js');
    const { computeLocusDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      const explicitCwd = process.cwd();
      const locusDir = computeLocusDir(resolveProjectRoot(explicitCwd));
      cleanupDirs.push(locusDir);

      const uniqueSessionId = `emoji-${Date.now()}`;
      const transcriptPath = join(testDir, 'transcript-emoji.jsonl');

      // Emoji are 4 bytes each in UTF-8
      const line1 = `${JSON.stringify({
        type: 'assistant',
        message: { content: 'Hello 🎉🚀 World' },
      })}\n`;
      writeFileSync(transcriptPath, line1, 'utf-8');

      await stop({
        session_id: uniqueSessionId,
        transcript_path: transcriptPath,
        cwd: explicitCwd,
      });

      // Verify offset = byte length (not string length)
      const offset = loadTailerState(locusDir, uniqueSessionId);
      const byteLength = Buffer.byteLength(line1, 'utf-8');
      expect(offset).toBe(byteLength);

      // String length would be different from byte length due to emoji
      expect(byteLength).toBeGreaterThan(line1.length);
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('handles transcript with only non-assistant messages', async () => {
    const { default: stop } = await import('../../../claude-code/hooks/stop.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      const transcriptPath = join(testDir, 'no-assistant.jsonl');
      const lines = [
        JSON.stringify({ type: 'human', message: { content: 'Hello' } }),
        JSON.stringify({ type: 'tool_use', message: { content: 'tool call' } }),
      ];
      writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf-8');

      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      let filesBefore: string[] = [];
      try {
        filesBefore = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // ok
      }

      await stop({
        session_id: 'no-assistant-session',
        transcript_path: transcriptPath,
      });

      let filesAfter: string[] = [];
      try {
        filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // ok
      }

      // No new ai_response files
      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        expect(content.kind).not.toBe('ai_response');
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });
});
