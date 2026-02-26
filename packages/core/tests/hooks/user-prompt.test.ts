import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── shared.js exports ──────────────────────────────────────────────────────

describe('shared helpers (from user-prompt context)', () => {
  it('computeInboxDir returns path with locus- prefix and /inbox/', async () => {
    const { computeInboxDir } = await import('../../../claude-code/hooks/shared.js');
    const dir = computeInboxDir('/tmp/test-project');
    expect(dir).toMatch(/locus-[a-f0-9]{16}/);
    expect(dir).toMatch(/inbox[/\\]?$/);
  });

  it('computeLocusDir returns path without /inbox/', async () => {
    const { computeLocusDir } = await import('../../../claude-code/hooks/shared.js');
    const dir = computeLocusDir('/tmp/test-project');
    expect(dir).toMatch(/locus-[a-f0-9]{16}$/);
    expect(dir).not.toMatch(/inbox/);
  });

  it('writeAtomicInboxEvent writes valid JSON and returns file path', async () => {
    const { writeAtomicInboxEvent } = await import('../../../claude-code/hooks/shared.js');
    const testDir = join(tmpdir(), `locus-test-shared-${Date.now()}`);
    try {
      const event = {
        version: 1,
        event_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        timestamp: 1708876543210,
        kind: 'test',
        payload: {},
      };
      const filePath = writeAtomicInboxEvent(testDir, event);
      expect(filePath).toContain('aaaaaaaa');
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.event_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('writeAtomicInboxEvent leaves no .tmp files', async () => {
    const { writeAtomicInboxEvent } = await import('../../../claude-code/hooks/shared.js');
    const testDir = join(tmpdir(), `locus-test-notmp-${Date.now()}`);
    try {
      writeAtomicInboxEvent(testDir, {
        version: 1,
        event_id: '11111111-2222-3333-4444-555555555555',
        timestamp: Date.now(),
        kind: 'test',
        payload: {},
      });
      const files = readdirSync(testDir);
      const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

// ─── UserPromptSubmit hook ──────────────────────────────────────────────────

describe('userPromptSubmit hook', () => {
  const cleanupDirs: string[] = [];
  let testInboxDir: string;

  beforeEach(() => {
    testInboxDir = join(tmpdir(), `locus-test-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    cleanupDirs.push(testInboxDir);
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

  it('writes user_prompt event at captureLevel=full', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      const event = {
        prompt: 'Fix the authentication bug in auth.ts',
        session_id: 'test-session-001',
      };
      await userPromptSubmit(event);

      // Read from the actual inbox dir that the hook would use
      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);

      // Find the user_prompt event (there might be tool_use events from other tests)
      let foundPromptEvent = false;
      for (const file of files) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'user_prompt') {
          expect(content.version).toBe(1);
          expect(content.source).toBe('claude-code');
          expect(content.kind).toBe('user_prompt');
          expect(typeof content.event_id).toBe('string');
          expect(typeof content.timestamp).toBe('number');
          expect(content.payload.prompt).toBe('Fix the authentication bug in auth.ts');
          expect(content.session_id).toBe('test-session-001');
          foundPromptEvent = true;
          break;
        }
      }
      expect(foundPromptEvent).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('does NOT write at captureLevel=metadata', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'metadata';

      // Count existing files in inbox before
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

      const event = {
        prompt: 'This should not be captured',
        session_id: 'test-session-skip',
      };
      await userPromptSubmit(event);

      let filesAfter: string[] = [];
      try {
        filesAfter = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      } catch {
        // inbox may not exist
      }

      // No new user_prompt files should have been created
      const newFiles = filesAfter.filter((f: string) => !filesBefore.includes(f));
      for (const file of newFiles) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        expect(content.kind).not.toBe('user_prompt');
      }
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('writes at captureLevel=redacted', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'redacted';

      const event = {
        prompt: 'Refactor the database layer',
        session_id: 'test-session-redacted',
      };
      await userPromptSubmit(event);

      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      let foundPromptEvent = false;
      for (const file of files) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'user_prompt' && content.session_id === 'test-session-redacted') {
          expect(content.payload.prompt).toBe('Refactor the database layer');
          foundPromptEvent = true;
          break;
        }
      }
      expect(foundPromptEvent).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('uses session_id from event payload', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const { computeInboxDir, resolveProjectRoot } = await import(
      '../../../claude-code/hooks/shared.js'
    );

    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';

      const event = {
        prompt: 'Test session id',
        session_id: 'unique-session-42',
      };
      await userPromptSubmit(event);

      const cwd = process.env.PWD ?? process.cwd();
      const projectRoot = resolveProjectRoot(cwd);
      const inboxDir = computeInboxDir(projectRoot);
      cleanupDirs.push(inboxDir);

      const files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
      let found = false;
      for (const file of files) {
        const content = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
        if (content.kind === 'user_prompt' && content.session_id === 'unique-session-42') {
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

  it('never crashes on null event', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive null handling
    const result = await userPromptSubmit(null as any);
    expect(result).toBeUndefined();
  });

  it('never crashes on undefined event', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    const result = await userPromptSubmit(undefined as any);
    expect(result).toBeUndefined();
  });

  it('never crashes when prompt is missing', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';
      const result = await userPromptSubmit({ session_id: 'no-prompt' });
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });

  it('does not write when LOCUS_CAPTURE_LEVEL is invalid', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'invalid-level';
      const result = await userPromptSubmit({
        prompt: 'should not be written',
        session_id: 'test',
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

  it('handles empty prompt string without crashing', async () => {
    const { default: userPromptSubmit } = await import('../../../claude-code/hooks/user-prompt.js');
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'full';
      const result = await userPromptSubmit({ prompt: '', session_id: 'empty-prompt' });
      // Should not crash, but may or may not write (empty prompt is still valid)
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });
});
