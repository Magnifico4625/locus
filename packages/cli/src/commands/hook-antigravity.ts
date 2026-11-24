import { createHash } from 'node:crypto';
import {
  buildPromptRecallBrief,
  buildSessionStartBrief,
  type CaptureLevel,
  formatLocalDateKey,
  type InboxEvent,
  initStorage,
  isDenylisted,
  isNoisyPrompt,
  processInbox,
  resolveJournalDirFromDbPath,
  runDurableExtraction,
  syncDailyJournal,
  writeInboxEvent,
} from '@locus/core';
import { resolveDbPath, resolveInboxDir } from '@locus/shared-runtime';
import { resolveAntigravitySessionStatePath } from '../antigravity/paths.js';
import {
  hashPrompt,
  readAntigravitySessionState,
  writeAntigravitySessionState,
} from '../antigravity/session-state.js';
import {
  antigravityTranscriptCursorKey,
  parseAntigravityTranscriptEvents,
} from '../antigravity/transcript.js';
import { normalizeCaptureLevel, withScopedEnv } from '../env-scope.js';
import { evaluateHookWorkspace } from '../workspace-gate.js';

export type AntigravityHookEvent = 'session-start' | 'pre-invocation' | 'post-tool-use' | 'stop';

export interface AntigravityHookResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

export interface RunAntigravityHookOptions {
  event?: string;
  stdin?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

const SUPPORTED_EVENTS = new Set<AntigravityHookEvent>([
  'session-start',
  'pre-invocation',
  'post-tool-use',
  'stop',
]);

const CAPTURED_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'run_command',
]);

const FILE_ARG_KEYS = ['Path', 'TargetFile', 'AbsolutePath', 'path', 'file_path', 'files'];

export function isAntigravityHookEvent(event: string | undefined): event is AntigravityHookEvent {
  return typeof event === 'string' && SUPPORTED_EVENTS.has(event as AntigravityHookEvent);
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
    const parsed = JSON.parse(stdin) as unknown;
    return isPlainObject(parsed) ? { ok: true, value: parsed } : { ok: true, value: {} };
  } catch {
    return { ok: false };
  }
}

function resolveWorkspaceRawCwd(input: Record<string, unknown>): string | undefined {
  if (Array.isArray(input.workspacePaths)) {
    for (const item of input.workspacePaths) {
      const candidate = stringField(item);
      if (candidate) {
        return candidate;
      }
    }
  }

  return stringField(input.cwd);
}

function deterministicEventId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function resolveAntigravityCaptureLevel(env: Record<string, string | undefined>): CaptureLevel {
  return normalizeCaptureLevel(
    env.LOCUS_ANTIGRAVITY_CAPTURE ?? env.LOCUS_CAPTURE_LEVEL,
    'redacted',
  );
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

function formatInjectStepsStdout(text: string): string {
  return JSON.stringify({
    injectSteps: [
      {
        systemMessage: {
          systemMessage: text,
        },
      },
    ],
  });
}

async function handleSessionStart(context: {
  projectRoot: string;
  conversationId: string;
  captureLevel: CaptureLevel;
  modelName?: string;
  nowMs: number;
  env: Record<string, string | undefined>;
}): Promise<AntigravityHookResult> {
  const dbPath = resolveDbPath(context.projectRoot);
  const inboxDir = resolveInboxDir(context.projectRoot);
  const startEvent: InboxEvent = {
    version: 1,
    event_id: deterministicEventId(`antigravity:${context.conversationId}:session_start`),
    source: 'antigravity',
    source_event_id: `antigravity:${context.conversationId}:session_start`,
    project_root: context.projectRoot,
    session_id: context.conversationId,
    timestamp: context.nowMs,
    kind: 'session_start',
    payload: {
      tool: 'antigravity',
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
      const ingestMetrics = processInbox(inboxDir, db, {
        batchLimit: 100,
        captureLevel: context.captureLevel,
        fts5Available: fts5,
        projectRoot: context.projectRoot,
      });
      runDurableExtraction(db);
      if (ingestMetrics.processed > 0) {
        syncDailyJournal({
          db,
          projectRoot: context.projectRoot,
          journalDir: resolveJournalDirFromDbPath(dbPath),
          dateKeys: [formatLocalDateKey(context.nowMs)],
          now: context.nowMs,
        });
      }
    } catch {
      // Best-effort pre-brief ingest
    }

    const brief = buildSessionStartBrief({
      db,
      projectRoot: context.projectRoot,
      now: context.nowMs,
    });

    const existingState = readAntigravitySessionState(context.conversationId, context.env);
    writeAntigravitySessionState(
      {
        conversationId: context.conversationId,
        sessionStartInjected: true,
        ...(existingState.lastPromptHash ? { lastPromptHash: existingState.lastPromptHash } : {}),
        injectedDurableIds: [...existingState.injectedDurableIds, ...brief.includedDurableIds],
        injectedEventIds: [...existingState.injectedEventIds, ...brief.includedEventIds],
        updatedAt: context.nowMs,
      },
      context.env,
    );

    return {
      exitCode: 0,
      stdout: brief.injected ? formatInjectStepsStdout(brief.text) : '{}',
    };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup close error
    }
  }
}

async function handlePreInvocation(context: {
  projectRoot: string;
  conversationId: string;
  lastUserInput?: string;
  nowMs: number;
  env: Record<string, string | undefined>;
}): Promise<AntigravityHookResult> {
  if (!context.lastUserInput) {
    return { exitCode: 0, stdout: '{}' };
  }

  const state = readAntigravitySessionState(context.conversationId, context.env);
  const promptHash = hashPrompt(context.lastUserInput);

  if (state.lastPromptHash === promptHash) {
    return { exitCode: 0, stdout: '{}' };
  }

  if (isNoisyPrompt(context.lastUserInput)) {
    writeAntigravitySessionState(
      {
        ...state,
        lastPromptHash: promptHash,
        updatedAt: context.nowMs,
      },
      context.env,
    );
    return { exitCode: 0, stdout: '{}' };
  }

  const { db } = await initStorage(resolveDbPath(context.projectRoot));
  try {
    const brief = buildPromptRecallBrief(
      context.lastUserInput,
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

    writeAntigravitySessionState(
      {
        conversationId: context.conversationId,
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
      stdout: brief.injected ? formatInjectStepsStdout(brief.text) : '{}',
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
  conversationId: string;
  nowMs: number;
}): AntigravityHookResult {
  const toolCall = isPlainObject(context.input.toolCall) ? context.input.toolCall : undefined;
  const toolName = toolCall ? stringField(toolCall.name) : undefined;
  if (!toolName || isLocusToolName(toolName)) {
    return { exitCode: 0, stdout: '{}' };
  }

  const errorText = stringField(context.input.error);
  const shouldCapture = Boolean(errorText) || CAPTURED_TOOL_NAMES.has(toolName.toLowerCase());
  if (!shouldCapture) {
    return { exitCode: 0, stdout: '{}' };
  }

  const toolId = toolCall ? stringField(toolCall.id) : undefined;
  const stepIdx =
    typeof context.input.stepIdx === 'number' && Number.isInteger(context.input.stepIdx)
      ? context.input.stepIdx
      : undefined;
  const toolArgs = toolCall && isPlainObject(toolCall.args) ? toolCall.args : {};
  const files = extractCandidateFiles(toolArgs);

  const sourceEventId = toolId
    ? `antigravity:${context.conversationId}:tool:${toolId}`
    : stepIdx !== undefined
      ? `antigravity:${context.conversationId}:tool:step-${stepIdx}:${toolName}`
      : `antigravity:${context.conversationId}:tool:${context.nowMs}:${toolName}`;

  const event: InboxEvent = {
    version: 1,
    event_id: deterministicEventId(`${sourceEventId}:post_tool_use`),
    source: 'antigravity',
    source_event_id: sourceEventId,
    project_root: context.projectRoot,
    session_id: context.conversationId,
    timestamp: context.nowMs,
    kind: 'tool_use',
    payload: {
      tool: toolName,
      files,
      status: errorText ? 'error' : 'success',
    },
  };

  writeInboxEvent(resolveInboxDir(context.projectRoot), event);
  return { exitCode: 0, stdout: '{}' };
}

async function handleStop(context: {
  input: Record<string, unknown>;
  projectRoot: string;
  conversationId: string;
  captureLevel: CaptureLevel;
  nowMs: number;
}): Promise<AntigravityHookResult> {
  const dbPath = resolveDbPath(context.projectRoot);
  const inboxDir = resolveInboxDir(context.projectRoot);
  const transcriptPath = stringField(context.input.transcriptPath);

  const { db, fts5 } = await initStorage(dbPath);
  try {
    if (transcriptPath) {
      const cursorKey = antigravityTranscriptCursorKey(context.conversationId);
      const cursorRow = db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
        cursorKey,
      ]);
      const parsedCursor = cursorRow ? Number.parseInt(cursorRow.value, 10) : Number.NaN;
      const afterStepIndex =
        Number.isInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : -1;

      const parsedTranscript = parseAntigravityTranscriptEvents({
        transcriptPath,
        conversationId: context.conversationId,
        projectRoot: context.projectRoot,
        captureLevel: context.captureLevel,
        afterStepIndex,
        now: context.nowMs,
      });

      for (const event of parsedTranscript.events) {
        writeInboxEvent(inboxDir, event);
      }

      if (parsedTranscript.maxStepIndex > afterStepIndex) {
        db.run('INSERT OR REPLACE INTO scan_state (key, value) VALUES (?, ?)', [
          cursorKey,
          String(parsedTranscript.maxStepIndex),
        ]);
      }
    }

    processInbox(inboxDir, db, {
      batchLimit: 200,
      captureLevel: context.captureLevel,
      fts5Available: fts5,
      projectRoot: context.projectRoot,
    });
    runDurableExtraction(db);
    try {
      syncDailyJournal({
        db,
        projectRoot: context.projectRoot,
        journalDir: resolveJournalDirFromDbPath(dbPath),
        dateKeys: [formatLocalDateKey(context.nowMs)],
        now: context.nowMs,
      });
    } catch {
      // Best-effort daily journal sync on Stop
    }

    return { exitCode: 0, stdout: '{}' };
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup close error
    }
  }
}

export async function runAntigravityHook(
  options: RunAntigravityHookOptions,
): Promise<AntigravityHookResult> {
  const event = options.event;
  if (!isAntigravityHookEvent(event)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unsupported Antigravity hook event: ${event ?? '(missing)'}`,
    };
  }

  const parsed = parseHookInput(options.stdin);
  if (!parsed.ok) {
    return {
      exitCode: 0,
      stdout: '{}',
      stderr: 'malformed Antigravity hook input; failing open',
    };
  }

  const baseEnv = options.env ?? process.env;
  const scopedEnv: Record<string, string | undefined> = {
    ...baseEnv,
    LOCUS_CLIENT: baseEnv.LOCUS_CLIENT ?? 'antigravity',
    LOCUS_CLIENT_SURFACE: baseEnv.LOCUS_CLIENT_SURFACE ?? 'desktop',
  };

  try {
    return await withScopedEnv(options.env ? scopedEnv : undefined, async () => {
      const effectiveEnv = options.env ? scopedEnv : process.env;
      const nowMs = (options.now ?? new Date()).getTime();
      const input = parsed.value;
      const conversationId = stringField(input.conversationId) ?? 'default';
      const rawCwd = resolveWorkspaceRawCwd(input);
      const gate = evaluateHookWorkspace({ rawCwd, env: effectiveEnv });
      if (!gate.allowed) {
        return { exitCode: 0, stdout: '{}' };
      }

      const projectRoot = gate.projectRoot;
      const captureLevel = resolveAntigravityCaptureLevel(effectiveEnv);

      // Ensure state directory path resolves cleanly even when LOCUS_HOME is customized
      resolveAntigravitySessionStatePath(conversationId, effectiveEnv);

      if (event === 'session-start') {
        return handleSessionStart({
          projectRoot,
          conversationId,
          captureLevel,
          modelName: stringField(input.modelName),
          nowMs,
          env: effectiveEnv,
        });
      }

      if (event === 'pre-invocation') {
        return handlePreInvocation({
          projectRoot,
          conversationId,
          lastUserInput: stringField(input.lastUserInput),
          nowMs,
          env: effectiveEnv,
        });
      }

      if (event === 'post-tool-use') {
        return handlePostToolUse({
          input,
          projectRoot,
          conversationId,
          nowMs,
        });
      }

      return handleStop({
        input,
        projectRoot,
        conversationId,
        captureLevel,
        nowMs,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 0,
      stdout: '{}',
      stderr: `Antigravity hook error; failing open: ${message}`,
    };
  }
}
