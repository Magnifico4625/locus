import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importCodexSessionsToInbox, toInboxEvent } from '@locus/codex';
import {
  buildPromptRecallBrief,
  buildSessionStartBrief,
  type CaptureLevel,
  type InboxEvent,
  initStorage,
  isDenylisted,
  isNoisyPrompt,
  processInbox,
  resolveProjectRoot,
  runDurableExtraction,
  writeInboxEvent,
} from '@locus/core';
import { resolveDbPath, resolveInboxDir } from '@locus/shared-runtime';
import { resolveCodexHome } from '../codex/paths.js';
import { normalizeCaptureLevel, withScopedEnv } from '../env-scope.js';
import { hashPrompt, readHookSessionState, writeHookSessionState } from '../hook-session-state.js';

export type CodexHookEvent = 'session-start' | 'user-prompt-submit' | 'post-tool-use' | 'stop';

export interface CodexHookResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

export interface RunCodexHookOptions {
  event?: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

const SUPPORTED_EVENTS = new Set<CodexHookEvent>([
  'session-start',
  'user-prompt-submit',
  'post-tool-use',
  'stop',
]);

const PROMPT_KEYS = ['prompt', 'text', 'input', 'user_prompt'] as const;
const CWD_KEYS = ['cwd', 'workingDirectory', 'workdir'] as const;
const FILE_ARG_KEYS = ['path', 'file_path', 'target_file', 'TargetFile', 'Path', 'files'] as const;

const CAPTURED_TOOLS = new Set([
  'bash',
  'shell',
  'exec_command',
  'apply_patch',
  'write',
  'edit',
  'write_file',
  'edit_file',
  'notebookedit',
  'run_terminal_command',
]);

const READ_ONLY_TOOLS = new Set(['read', 'glob', 'grep', 'view_image', 'read_file', 'list_dir']);

export function isCodexHookEvent(event: string | undefined): event is CodexHookEvent {
  return typeof event === 'string' && SUPPORTED_EVENTS.has(event as CodexHookEvent);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseHookInput(
  stdin: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (!stdin || stdin.trim().length === 0) {
    return { ok: true, value: {} };
  }

  try {
    const value = JSON.parse(stdin) as unknown;
    return isPlainObject(value) ? { ok: true, value } : { ok: true, value: {} };
  } catch {
    return { ok: false };
  }
}

function extractRecursiveKey(value: unknown, keys: readonly string[]): string | undefined {
  if (isPlainObject(value)) {
    for (const key of keys) {
      const candidate = stringField(value[key]);
      if (candidate) {
        return candidate;
      }
    }
    for (const nested of Object.values(value)) {
      const candidate = extractRecursiveKey(nested, keys);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const nested of value) {
      const candidate = extractRecursiveKey(nested, keys);
      if (candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

function extractWorkspaceRawCwd(input: Record<string, unknown>): string {
  const fromKeys = extractRecursiveKey(input, CWD_KEYS);
  if (fromKeys) {
    return fromKeys;
  }

  if (Array.isArray(input.workspacePaths)) {
    for (const item of input.workspacePaths) {
      const candidate = stringField(item);
      if (candidate) {
        return candidate;
      }
    }
  }

  return process.cwd();
}

function extractSessionId(input: Record<string, unknown>): string {
  return (
    stringField(input.session_id) ??
    stringField(input.sessionId) ??
    stringField(input.thread_id) ??
    stringField(input.threadId) ??
    'default'
  );
}

function deterministicEventId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function isLocusToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.includes('locus') || lower.includes('memory_');
}

function extractCandidateFiles(args: Record<string, unknown>): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  for (const key of FILE_ARG_KEYS) {
    const raw = args[key];
    if (typeof raw === 'string') {
      const candidate = raw.trim();
      if (candidate && !seen.has(candidate) && !isDenylisted(candidate)) {
        seen.add(candidate);
        collected.push(candidate);
      }
      continue;
    }

    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') {
          continue;
        }
        const candidate = entry.trim();
        if (candidate && !seen.has(candidate) && !isDenylisted(candidate)) {
          seen.add(candidate);
          collected.push(candidate);
        }
      }
    }
  }

  return collected;
}

function failOpenStdout(event: CodexHookEvent): string {
  return event === 'post-tool-use' ? '' : JSON.stringify({ continue: true, suppressOutput: true });
}

function formatContinueWithContext(
  hookEventName: 'SessionStart' | 'UserPromptSubmit',
  additionalContext: string,
): string {
  return JSON.stringify({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  });
}

async function handleSessionStart(context: {
  projectRoot: string;
  sessionId: string;
  captureLevel: CaptureLevel;
  modelName?: string;
  nowMs: number;
  env: Record<string, string | undefined>;
}): Promise<CodexHookResult> {
  const dbPath = resolveDbPath(context.projectRoot);
  const inboxDir = resolveInboxDir(context.projectRoot);
  const startEvent: InboxEvent = {
    version: 1,
    event_id: deterministicEventId(`codex:${context.sessionId}:session_start`),
    source: 'codex',
    source_event_id: `codex:${context.sessionId}:session_start`,
    project_root: context.projectRoot,
    session_id: context.sessionId,
    timestamp: context.nowMs,
    kind: 'session_start',
    payload: {
      tool: 'codex',
      ...(context.modelName ? { model: context.modelName } : {}),
    },
  };

  try {
    writeInboxEvent(inboxDir, startEvent);
  } catch {
    // Best-effort inbox write
  }

  const { db, fts5 } = await initStorage(dbPath);
  try {
    try {
      processInbox(inboxDir, db, {
        batchLimit: 100,
        captureLevel: context.captureLevel,
        fts5Available: fts5,
        projectRoot: context.projectRoot,
      });
      runDurableExtraction(db);
    } catch {
      // Best-effort pre-brief ingest
    }

    const brief = buildSessionStartBrief({
      db,
      projectRoot: context.projectRoot,
      now: context.nowMs,
    });

    const existing = readHookSessionState('codex', context.sessionId, context.env);
    writeHookSessionState(
      'codex',
      {
        sessionId: context.sessionId,
        sessionStartInjected: true,
        ...(existing.lastPromptHash ? { lastPromptHash: existing.lastPromptHash } : {}),
        injectedDurableIds: [...existing.injectedDurableIds, ...brief.includedDurableIds],
        injectedEventIds: [...existing.injectedEventIds, ...brief.includedEventIds],
        updatedAt: context.nowMs,
      },
      context.env,
    );

    return {
      exitCode: 0,
      stdout: brief.injected
        ? formatContinueWithContext('SessionStart', brief.text)
        : failOpenStdout('session-start'),
    };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup close error
    }
  }
}

async function handleUserPromptSubmit(context: {
  input: Record<string, unknown>;
  projectRoot: string;
  sessionId: string;
  nowMs: number;
  env: Record<string, string | undefined>;
}): Promise<CodexHookResult> {
  const prompt = extractRecursiveKey(context.input, PROMPT_KEYS);
  if (!prompt) {
    return { exitCode: 0, stdout: failOpenStdout('user-prompt-submit') };
  }

  const state = readHookSessionState('codex', context.sessionId, context.env);
  const promptHash = hashPrompt(prompt);

  if (state.lastPromptHash === promptHash) {
    return { exitCode: 0, stdout: failOpenStdout('user-prompt-submit') };
  }

  if (isNoisyPrompt(prompt)) {
    writeHookSessionState(
      'codex',
      {
        ...state,
        lastPromptHash: promptHash,
        updatedAt: context.nowMs,
      },
      context.env,
    );
    return { exitCode: 0, stdout: failOpenStdout('user-prompt-submit') };
  }

  const { db } = await initStorage(resolveDbPath(context.projectRoot));
  try {
    const brief = buildPromptRecallBrief(
      prompt,
      {
        db,
        projectRoot: context.projectRoot,
        now: context.nowMs,
      },
      {
        alreadyInjectedDurableIds: state.injectedDurableIds,
        alreadyInjectedEventIds: state.injectedEventIds,
      },
    );

    writeHookSessionState(
      'codex',
      {
        sessionId: context.sessionId,
        sessionStartInjected: state.sessionStartInjected,
        lastPromptHash: promptHash,
        injectedDurableIds: brief.injected
          ? [...state.injectedDurableIds, ...brief.includedDurableIds]
          : state.injectedDurableIds,
        injectedEventIds: brief.injected
          ? [...state.injectedEventIds, ...brief.includedEventIds]
          : state.injectedEventIds,
        updatedAt: context.nowMs,
      },
      context.env,
    );

    return {
      exitCode: 0,
      stdout: brief.injected
        ? formatContinueWithContext('UserPromptSubmit', brief.text)
        : failOpenStdout('user-prompt-submit'),
    };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup close error
    }
  }
}

function handlePostToolUse(context: {
  input: Record<string, unknown>;
  projectRoot: string;
  sessionId: string;
  nowMs: number;
}): CodexHookResult {
  const toolName =
    stringField(context.input.tool_name) ??
    stringField(context.input.toolName) ??
    stringField(context.input.tool);
  if (!toolName || isLocusToolName(toolName)) {
    return { exitCode: 0, stdout: '' };
  }

  const isError =
    Boolean(stringField(context.input.error)) ||
    context.input.success === false ||
    context.input.is_error === true;
  const lowerTool = toolName.toLowerCase();
  const shouldCapture =
    isError || (CAPTURED_TOOLS.has(lowerTool) && !READ_ONLY_TOOLS.has(lowerTool));

  if (!shouldCapture) {
    return { exitCode: 0, stdout: '' };
  }

  const toolInput = isPlainObject(context.input.tool_input)
    ? context.input.tool_input
    : isPlainObject(context.input.toolInput)
      ? context.input.toolInput
      : {};
  const files = extractCandidateFiles(toolInput);
  const callId =
    stringField(context.input.call_id) ??
    stringField(context.input.tool_use_id) ??
    stringField(context.input.id);

  const sourceEventId = callId
    ? `codex:${context.sessionId}:tool:${callId}`
    : `codex:${context.sessionId}:tool:${context.nowMs}:${toolName}`;

  const event: InboxEvent = {
    version: 1,
    event_id: deterministicEventId(`${sourceEventId}:post_tool_use`),
    source: 'codex',
    source_event_id: sourceEventId,
    project_root: context.projectRoot,
    session_id: context.sessionId,
    timestamp: context.nowMs,
    kind: 'tool_use',
    payload: {
      tool: toolName,
      files,
      status: isError ? 'error' : 'success',
    },
  };

  writeInboxEvent(resolveInboxDir(context.projectRoot), event);
  return { exitCode: 0, stdout: '' };
}

async function handleStop(context: {
  input: Record<string, unknown>;
  projectRoot: string;
  sessionId: string;
  captureLevel: CaptureLevel;
  importDisabled: boolean;
  nowDate: Date;
  env: Record<string, string | undefined>;
}): Promise<CodexHookResult> {
  const writeResult = writeStopTrigger({
    env: context.env,
    input: context.input,
    now: context.nowDate,
  });

  const dbPath = resolveDbPath(context.projectRoot);
  const inboxDir = resolveInboxDir(context.projectRoot);
  const { db, fts5 } = await initStorage(dbPath);
  try {
    if (!context.importDisabled) {
      try {
        importCodexSessionsToInbox({
          inboxDir,
          projectRoot: context.projectRoot,
          env: context.env,
          captureMode: context.captureLevel,
          latestOnly: true,
          maxFileBytes: 10 * 1024 * 1024,
          shouldSkipEventId: (eventId) =>
            db.get<{ id: number }>('SELECT id FROM ingest_log WHERE event_id = ?', [eventId]) !==
            undefined,
        });
      } catch {
        // Best-effort Codex rollout JSONL import on Stop
      }

      if (context.captureLevel !== 'metadata') {
        const lastAssistantMessage = stringField(context.input.last_assistant_message);
        if (lastAssistantMessage) {
          const candidateEvent = toInboxEvent(
            {
              kind: 'ai_response',
              timestamp: context.nowDate.getTime(),
              sessionId: context.sessionId,
              projectRoot: context.projectRoot,
              sourceFile: 'hook:stop',
              sourceLine: 1,
              payload: {
                response: lastAssistantMessage,
              },
            },
            context.captureLevel,
          );
          const responseText =
            typeof candidateEvent?.payload.response === 'string'
              ? candidateEvent.payload.response
              : '';
          if (candidateEvent && responseText.length > 0) {
            const stopEventId = `codex:${context.sessionId}:stop:${hashPrompt(responseText)}`;
            const responseEvent: InboxEvent = {
              ...candidateEvent,
              event_id: deterministicEventId(stopEventId),
              source_event_id: stopEventId,
              kind: 'ai_response',
            };
            try {
              writeInboxEvent(inboxDir, responseEvent);
            } catch {
              // Best-effort Stop response inbox write
            }
          }
        }
      }
    }

    processInbox(inboxDir, db, {
      batchLimit: 200,
      captureLevel: context.captureLevel,
      fts5Available: fts5,
      projectRoot: context.projectRoot,
    });
    runDurableExtraction(db);

    return {
      exitCode: 0,
      stdout: failOpenStdout('stop'),
      ...(writeResult.ok
        ? {}
        : {
            stderr: `could not write Codex hook trigger; failing open: ${writeResult.error.message}`,
          }),
    };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup close error
    }
  }
}

export async function runCodexHook(options: RunCodexHookOptions): Promise<CodexHookResult> {
  const event = options.event;
  if (!isCodexHookEvent(event)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unsupported Codex hook event: ${event ?? '(missing)'}`,
    };
  }

  const parsed = parseHookInput(options.stdin);
  if (!parsed.ok) {
    return {
      exitCode: 0,
      stdout: failOpenStdout(event),
      stderr: 'malformed Codex hook input; failing open',
    };
  }

  const baseEnv = options.env ?? process.env;
  const scopedEnv: Record<string, string | undefined> = {
    ...baseEnv,
    LOCUS_CLIENT: baseEnv.LOCUS_CLIENT ?? 'codex',
    LOCUS_CLIENT_SURFACE: baseEnv.LOCUS_CLIENT_SURFACE ?? 'desktop',
  };

  try {
    return await withScopedEnv(options.env ? scopedEnv : undefined, async () => {
      const effectiveEnv = options.env ? scopedEnv : process.env;
      const nowDate = options.now ?? new Date();
      const nowMs = nowDate.getTime();
      const input = parsed.value;
      const rawCodexCapture = effectiveEnv.LOCUS_CODEX_CAPTURE?.trim().toLowerCase();
      const importDisabled = rawCodexCapture === 'off';
      const captureLevel = normalizeCaptureLevel(
        importDisabled
          ? effectiveEnv.LOCUS_CAPTURE_LEVEL
          : (effectiveEnv.LOCUS_CODEX_CAPTURE ?? effectiveEnv.LOCUS_CAPTURE_LEVEL),
        'redacted',
      );
      const rawCwd = extractWorkspaceRawCwd(input);
      const { root: projectRoot } = resolveProjectRoot(rawCwd);
      const sessionId = extractSessionId(input);

      if (event === 'session-start') {
        return handleSessionStart({
          projectRoot,
          sessionId,
          captureLevel,
          modelName: stringField(input.model),
          nowMs,
          env: effectiveEnv,
        });
      }

      if (event === 'user-prompt-submit') {
        return handleUserPromptSubmit({
          input,
          projectRoot,
          sessionId,
          nowMs,
          env: effectiveEnv,
        });
      }

      if (event === 'post-tool-use') {
        return handlePostToolUse({
          input,
          projectRoot,
          sessionId,
          nowMs,
        });
      }

      return handleStop({
        input,
        projectRoot,
        sessionId,
        captureLevel,
        importDisabled,
        nowDate,
        env: effectiveEnv,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 0,
      stdout: failOpenStdout(event),
      stderr: `Codex hook error; failing open: ${message}`,
    };
  }
}

function writeStopTrigger(options: {
  env?: Record<string, string | undefined>;
  input: Record<string, unknown>;
  now: Date;
}): { ok: true } | { ok: false; error: Error } {
  try {
    const triggerDir = join(resolveCodexHome(options.env), 'locus', 'hook-triggers');
    mkdirSync(triggerDir, { recursive: true });

    const id = `${options.now.getTime()}-${randomBytes(4).toString('hex')}`;
    const finalPath = join(triggerDir, `stop-${id}.json`);
    const tempPath = `${finalPath}.tmp`;
    const payload = {
      event: 'stop',
      createdAt: options.now.toISOString(),
      sessionId: stringField(options.input.session_id),
      turnId: stringField(options.input.turn_id),
    };

    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tempPath, finalPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
