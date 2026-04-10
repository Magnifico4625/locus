/**
 * E2E subprocess tests for Claude Code hooks.
 *
 * These tests verify the stdin bootstrap — the exact mechanism Claude Code uses
 * to invoke hooks. Each hook is spawned as a real subprocess with JSON piped to stdin.
 *
 * This is the test that would have caught the missing stdin reader bug.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// ─── Resolve hook file paths ─────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HOOKS_DIR = join(__dirname, '..', '..', '..', 'claude-code', 'hooks');

const USER_PROMPT_HOOK = join(HOOKS_DIR, 'user-prompt.js');
const POST_TOOL_USE_HOOK = join(HOOKS_DIR, 'post-tool-use.js');
const STOP_HOOK = join(HOOKS_DIR, 'stop.js');

// ─── Test project directory (temp dir with git init) ─────────────────────────

const TEST_PROJECT_DIR = join(tmpdir(), `locus-subprocess-test-${Date.now()}`);

// Use shared-runtime for consistent path resolution
import { resolveInboxDir } from '@locus/shared-runtime';

// ─── Helper ──────────────────────────────────────────────────────────────────

function runHook(
  hookFile: string,
  event: object,
  env?: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [hookFile], {
    input: JSON.stringify(event),
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 10000,
    cwd: TEST_PROJECT_DIR,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function getInboxFiles(projectRoot: string): string[] {
  const inboxDir = resolveInboxDir(projectRoot);
  if (!existsSync(inboxDir)) return [];
  return readdirSync(inboxDir).filter((f) => f.endsWith('.json'));
}

function readInboxEvent(projectRoot: string, filename: string): Record<string, unknown> {
  const inboxDir = resolveInboxDir(projectRoot);
  return JSON.parse(readFileSync(join(inboxDir, filename), 'utf-8'));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

// Create a temp project dir with git init so resolveProjectRoot works
mkdirSync(TEST_PROJECT_DIR, { recursive: true });
spawnSync('git', ['init'], { cwd: TEST_PROJECT_DIR, stdio: 'pipe' });
spawnSync('git', ['config', 'user.email', 'test@test.com'], {
  cwd: TEST_PROJECT_DIR,
  stdio: 'pipe',
});
spawnSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_PROJECT_DIR, stdio: 'pipe' });

// Clean up after all tests
afterAll(() => {
  // Remove test project dir
  rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });

  // Remove inbox files created during tests
  const inboxDir = resolveInboxDir(TEST_PROJECT_DIR);
  if (existsSync(inboxDir)) {
    rmSync(inboxDir, { recursive: true, force: true });
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Hook subprocess E2E — stdin bootstrap', () => {
  // ── PostToolUse ──────────────────────────────────────────────────────────

  describe('post-tool-use.js', () => {
    it('writes tool_use inbox event when invoked as subprocess', () => {
      const event = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.ts' },
        tool_response: '',
        session_id: `subp-ptu-${Date.now()}`,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(POST_TOOL_USE_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'metadata' });

      expect(result.status).toBe(0);

      const files = getInboxFiles(TEST_PROJECT_DIR);
      expect(files.length).toBeGreaterThan(0);

      // Find the tool_use event we just wrote
      const toolEvent = readInboxEvent(TEST_PROJECT_DIR, files[files.length - 1]);
      expect(toolEvent.kind).toBe('tool_use');
      expect(toolEvent.source).toBe('claude-code');
      expect(toolEvent.version).toBe(1);

      const payload = toolEvent.payload as Record<string, unknown>;
      expect(payload.tool).toBe('Read');
    });

    it('uses event.cwd for project root resolution', () => {
      const event = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' },
        tool_response: '',
        session_id: `subp-cwd-${Date.now()}`,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(POST_TOOL_USE_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'metadata' });
      expect(result.status).toBe(0);

      // Inbox should be under the test project hash, not the monorepo hash
      const inboxDir = resolveInboxDir(TEST_PROJECT_DIR);
      expect(existsSync(inboxDir)).toBe(true);
    });
  });

  // ── UserPromptSubmit ─────────────────────────────────────────────────────

  describe('user-prompt.js', () => {
    it('writes user_prompt inbox event at captureLevel=full', () => {
      const event = {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Fix the authentication bug in auth.ts',
        session_id: `subp-up-${Date.now()}`,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(USER_PROMPT_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'full' });

      expect(result.status).toBe(0);

      const files = getInboxFiles(TEST_PROJECT_DIR);
      const promptFiles = files.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'user_prompt';
      });
      expect(promptFiles.length).toBeGreaterThan(0);

      const promptEvent = readInboxEvent(TEST_PROJECT_DIR, promptFiles[promptFiles.length - 1]);
      expect(promptEvent.source).toBe('claude-code');
      expect(promptEvent.version).toBe(1);

      const payload = promptEvent.payload as Record<string, unknown>;
      expect(payload.prompt).toContain('authentication bug');
    });

    it('exits cleanly at captureLevel=metadata without writing', () => {
      // Clear inbox first to get a clean count
      const beforeFiles = getInboxFiles(TEST_PROJECT_DIR);
      const beforePromptCount = beforeFiles.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'user_prompt';
      }).length;

      const event = {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'This should not be captured',
        session_id: `subp-up-meta-${Date.now()}`,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(USER_PROMPT_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'metadata' });

      expect(result.status).toBe(0);

      // No new user_prompt files
      const afterFiles = getInboxFiles(TEST_PROJECT_DIR);
      const afterPromptCount = afterFiles.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'user_prompt';
      }).length;
      expect(afterPromptCount).toBe(beforePromptCount);
    });
  });

  // ── Stop ─────────────────────────────────────────────────────────────────

  describe('stop.js', () => {
    it('writes ai_response inbox event at captureLevel=full', () => {
      // Create a temp transcript JSONL file
      const transcriptPath = join(TEST_PROJECT_DIR, `transcript-${Date.now()}.jsonl`);
      const transcriptLines = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello, I fixed the bug for you.' }],
            model: 'claude-opus-4-6',
          },
        }),
      ];
      writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`, 'utf-8');

      const event = {
        hook_event_name: 'Stop',
        session_id: `subp-stop-${Date.now()}`,
        transcript_path: transcriptPath,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(STOP_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'full' });

      expect(result.status).toBe(0);

      const files = getInboxFiles(TEST_PROJECT_DIR);
      const aiFiles = files.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'ai_response';
      });
      expect(aiFiles.length).toBeGreaterThan(0);

      const aiEvent = readInboxEvent(TEST_PROJECT_DIR, aiFiles[aiFiles.length - 1]);
      expect(aiEvent.source).toBe('claude-code');

      const payload = aiEvent.payload as Record<string, unknown>;
      expect(payload.response).toContain('fixed the bug');
    });

    it('exits cleanly at captureLevel=metadata without writing ai_response', () => {
      const transcriptPath = join(TEST_PROJECT_DIR, `transcript-meta-${Date.now()}.jsonl`);
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: 'assistant',
          message: { content: 'Should not be captured' },
        })}\n`,
        'utf-8',
      );

      const beforeFiles = getInboxFiles(TEST_PROJECT_DIR);
      const beforeAiCount = beforeFiles.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'ai_response';
      }).length;

      const event = {
        hook_event_name: 'Stop',
        session_id: `subp-stop-meta-${Date.now()}`,
        transcript_path: transcriptPath,
        cwd: TEST_PROJECT_DIR,
      };

      const result = runHook(STOP_HOOK, event, { LOCUS_CAPTURE_LEVEL: 'metadata' });

      expect(result.status).toBe(0);

      const afterFiles = getInboxFiles(TEST_PROJECT_DIR);
      const afterAiCount = afterFiles.filter((f) => {
        const evt = readInboxEvent(TEST_PROJECT_DIR, f);
        return evt.kind === 'ai_response';
      }).length;
      expect(afterAiCount).toBe(beforeAiCount);
    });
  });

  // ── Resilience ───────────────────────────────────────────────────────────

  describe('resilience', () => {
    it('all hooks exit cleanly with empty JSON object on stdin', () => {
      const emptyEvent = {};

      for (const hookFile of [USER_PROMPT_HOOK, POST_TOOL_USE_HOOK, STOP_HOOK]) {
        const result = runHook(hookFile, emptyEvent);
        expect(result.status).toBe(0);
      }
    });
  });
});
