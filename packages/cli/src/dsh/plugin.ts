import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  projectHash,
  redact,
  resolveJournalDirFromDbPath,
  runDurableExtraction,
  syncDailyJournal,
  writeInboxEvent,
} from '@locus/core';
import { resolveLocusHome } from '@locus/shared-runtime';
import { normalizeCaptureLevel } from '../env-scope.js';
import { hashPrompt, readHookSessionState, writeHookSessionState } from '../hook-session-state.js';
import { evaluateHookWorkspace } from '../workspace-gate.js';
import { resolveDshNodeExecutable } from './paths.js';
import type {
  DshContext,
  DshMessage,
  DshPreStepDecision,
  DshSession,
  DshSessionEvent,
  DshToolExec,
  DshToolResult,
  LocusDshPluginConfig,
} from './plugin-types.js';

export const name = 'locus-memory';
export const inject = ['agents', 'workingDirectory', 'systemPrompt'] as const;

const SYSTEM_SECTION_ORDER = 9500;
const REDACTED_MAX_CHARS = 600;
const FULL_MAX_CHARS = 4000;

const LOCUS_SYSTEM_SECTION = [
  '# Locus Persistent Memory',
  '',
  'Locus injects verified local project memory (`[Locus Memory — Project Brief]` and `[Locus Memory — Relevant Recall]`) automatically before turns when relevant.',
  'Use injected memory as prior project context and verify live file state before acting.',
  'Avoid redundant MCP calls on simple continuation turns when automatic context already answers the question.',
  'When the `locus` MCP server is available, use `memory_recall`, `memory_calendar`, `memory_project_state`, `memory_remember`, `memory_review`, and `memory_forget` for deep historical queries or explicit persistence.',
].join('\n');

const CAPTURED_TOOLS = new Set([
  'bash',
  'pwsh',
  'shell',
  'shell_command',
  'exec',
  'exec_command',
  'apply_patch',
  'str_replace_editor',
  'write',
  'edit',
  'write_file',
  'edit_file',
  'notebookedit',
  'run_terminal_command',
]);

const READ_ONLY_TOOLS = new Set([
  'read',
  'glob',
  'grep',
  'read_file',
  'list_dir',
  'view_image',
  'web_search',
  'web_fetch',
]);

const FILE_ARG_KEYS = [
  'file_path',
  'path',
  'target_file',
  'TargetFile',
  'Path',
  'paths',
  'files',
] as const;

const SYSTEM_REMINDER_BLOCK_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
const HOOK_ECHO_PATTERNS: readonly RegExp[] = [
  /\[Locus Memory — (?:Project Brief|Relevant Recall)\][\s\S]*/gi,
  /The following system message was injected by a (?:PreInvocation|SessionStart|UserPromptSubmit) hook:[\s\S]*/gi,
];

export interface LocusDshPluginRuntime {
  env?: Record<string, string | undefined>;
  now?: () => number;
  defaultServerPath?: string;
}

export interface LocusDshPluginHandle {
  flushAll(): Promise<void>;
}

function expandLeadingTilde(value: string): string {
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

export function resolveDshProjectStorageDir(
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const storageRootOverride = env.LOCUS_STORAGE_ROOT?.trim();
  const baseRoot = storageRootOverride
    ? expandLeadingTilde(storageRootOverride)
    : join(resolveLocusHome(env), 'memory');
  return join(baseRoot, `locus-${projectHash(projectRoot)}`);
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

function deterministicEventId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

export function sanitizeDshText(raw: string): string {
  let cleaned = raw.replace(SYSTEM_REMINDER_BLOCK_RE, ' ');
  for (const pattern of HOOK_ECHO_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s+\n/g, '\n').trim();
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!isPlainObject(block)) {
      continue;
    }
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}

export function extractCandidateFilesFromArgs(rawArgs: unknown): string[] {
  let argsObj: Record<string, unknown> | undefined;
  if (isPlainObject(rawArgs)) {
    argsObj = rawArgs;
  } else if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (isPlainObject(parsed)) {
        argsObj = parsed;
      }
    } catch {
      return [];
    }
  }

  if (!argsObj) {
    return [];
  }

  const collected: string[] = [];
  const seen = new Set<string>();
  for (const key of FILE_ARG_KEYS) {
    const value = argsObj[key];
    if (typeof value === 'string') {
      const candidate = value.trim();
      if (candidate && !seen.has(candidate) && !isDenylisted(candidate)) {
        seen.add(candidate);
        collected.push(candidate);
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== 'string') continue;
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

export function createLocusContextMessage(
  text: string,
  sections: ReadonlyArray<{ name: string; text: string }>,
): DshMessage {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([
      Object.freeze({
        type: 'text',
        text: `<system-reminder>\n${text}\n</system-reminder>`,
      }),
    ]),
    source: Object.freeze({
      kind: 'locus-memory',
      form: 'snapshot',
      sections: Object.freeze(sections.map((section) => Object.freeze({ ...section }))),
    }),
  });
}

function isLocusToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.includes('locus') || lower.includes('memory_');
}

function resolveSessionRawCwd(ctx: DshContext, session: DshSession): string | undefined {
  try {
    const cwd = ctx.workingDirectory.get(session);
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      return cwd;
    }
  } catch {
    // Fallback to session header cwd when service state is unavailable
  }
  return stringField(session.header?.cwd);
}

function resolveSessionId(session: DshSession): string {
  return stringField(session.id) ?? stringField(session.header?.id) ?? 'default';
}

function resolveDefaultServerPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', 'runtime', 'server.js');
}

function resolveCaptureLevel(
  config: LocusDshPluginConfig,
  env: Record<string, string | undefined>,
): CaptureLevel {
  return (
    config.captureLevel ??
    normalizeCaptureLevel(env.LOCUS_DSH_CAPTURE ?? env.LOCUS_CAPTURE_LEVEL, 'redacted')
  );
}

function extractLatestHumanPrompt(messages: readonly DshMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user' || message.source?.kind !== 'user') {
      continue;
    }
    const text = sanitizeDshText(extractTextFromContent(message.content));
    if (text.length > 0) {
      return text;
    }
  }
  return undefined;
}

export function applyLocusDshPlugin(
  ctx: DshContext,
  config: LocusDshPluginConfig = {},
  runtime: LocusDshPluginRuntime = {},
): LocusDshPluginHandle {
  const env = runtime.env ?? process.env;
  const now = runtime.now ?? (() => Date.now());
  const captureLevel = resolveCaptureLevel(config, env);
  const maxChars = captureLevel === 'full' ? FULL_MAX_CHARS : REDACTED_MAX_CHARS;

  const projectQueues = new Map<string, Promise<void>>();
  const dirtyProjects = new Set<string>();
  const fallbackSeqCounters = new Map<string, number>();

  const runSerialized = <T>(projectRoot: string, task: () => Promise<T>): Promise<T> => {
    const previous = projectQueues.get(projectRoot) ?? Promise.resolve();
    const resultPromise = previous.then(task, task);
    const tail = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    projectQueues.set(projectRoot, tail);
    tail.finally(() => {
      if (projectQueues.get(projectRoot) === tail) {
        projectQueues.delete(projectRoot);
      }
    });
    return resultPromise;
  };

  const resolveProjectPaths = (projectRoot: string) => {
    const storageDir = resolveDshProjectStorageDir(projectRoot, env);
    return {
      storageDir,
      dbPath: join(storageDir, 'locus.db'),
      inboxDir: join(storageDir, 'inbox'),
    };
  };

  const flushProject = (projectRoot: string, flushNowMs = now()): Promise<void> =>
    runSerialized(projectRoot, async () => {
      dirtyProjects.delete(projectRoot);
      const { dbPath, inboxDir } = resolveProjectPaths(projectRoot);
      const { db, fts5 } = await initStorage(dbPath);
      try {
        processInbox(inboxDir, db, {
          batchLimit: 200,
          captureLevel,
          fts5Available: fts5,
          projectRoot,
        });
        runDurableExtraction(db);
        try {
          syncDailyJournal({
            db,
            projectRoot,
            journalDir: resolveJournalDirFromDbPath(dbPath),
            dateKeys: [formatLocalDateKey(flushNowMs)],
            now: flushNowMs,
          });
        } catch (error) {
          ctx.logger?.warn?.(
            `locus-memory: daily journal sync failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        try {
          db.close();
        } catch {
          // Ignore SQLite close failures on cleanup
        }
      }
    });

  const nextSyntheticSeq = (sessionId: string): number => {
    const nextValue = (fallbackSeqCounters.get(sessionId) ?? 0) + 1;
    fallbackSeqCounters.set(sessionId, nextValue);
    return nextValue;
  };

  ctx.systemPrompt.section({
    name: 'locus-memory:instructions',
    order: SYSTEM_SECTION_ORDER,
    interpolate: false,
    text: LOCUS_SYSTEM_SECTION,
  });

  if (config.enableMcp !== false && typeof ctx.inject === 'function') {
    const serverPath =
      stringField(config.serverPath) ?? runtime.defaultServerPath ?? resolveDefaultServerPath();
    if (existsSync(serverPath)) {
      ctx.inject(['mcpManager'], (mcpCtx) => {
        if (!mcpCtx.mcpManager) {
          return;
        }
        try {
          mcpCtx.mcpManager.register('locus', {
            transport: 'stdio',
            command: resolveDshNodeExecutable(env),
            args: [serverPath],
            env: {
              LOCUS_CLIENT: 'dsh',
              LOCUS_CLIENT_SURFACE: 'desktop',
              LOCUS_CAPTURE_LEVEL: captureLevel,
              LOCUS_LOG: 'error',
            },
          });
        } catch (error) {
          ctx.logger?.warn?.(
            `locus-memory: skipped automatic MCP registration: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    }
  }

  ctx.on('agent/pre-step', async (args, next): Promise<DshPreStepDecision> => {
    const decision = await next();
    if (decision.kind === 'reject' || args.signal?.aborted) {
      return decision;
    }

    try {
      const session = args.agent?.session;
      if (!session) {
        return decision;
      }

      const gate = evaluateHookWorkspace({
        rawCwd: resolveSessionRawCwd(ctx, session),
        env,
      });
      if (!gate.allowed) {
        return decision;
      }

      const projectRoot = gate.projectRoot;
      const sessionId = resolveSessionId(session);
      const nowMs = now();
      const prompt = extractLatestHumanPrompt(args.messages);
      const state = readHookSessionState('dsh', sessionId, env);

      if (!state.sessionStartInjected) {
        const modelName =
          stringField(args.modelSelection?.model) ?? stringField(args.agent.options?.model);
        const { dbPath, inboxDir } = resolveProjectPaths(projectRoot);
        const promptHash = prompt ? hashPrompt(prompt) : state.lastPromptHash;

        // Flush only pre-existing inbox events before building briefs so the current
        // session's own session_start event does not make an empty project look populated.
        const result = await runSerialized(projectRoot, async () => {
          const { db, fts5 } = await initStorage(dbPath);
          try {
            try {
              const ingestMetrics = processInbox(inboxDir, db, {
                batchLimit: 100,
                captureLevel,
                fts5Available: fts5,
                projectRoot,
              });
              runDurableExtraction(db);
              if (ingestMetrics.processed > 0) {
                syncDailyJournal({
                  db,
                  projectRoot,
                  journalDir: resolveJournalDirFromDbPath(dbPath),
                  dateKeys: [formatLocalDateKey(nowMs)],
                  now: nowMs,
                });
              }
            } catch {
              // Best-effort pre-brief ingest
            }

            const sessionBrief = buildSessionStartBrief(
              {
                db,
                projectRoot,
                now: nowMs,
              },
              config.maxBriefTokens ? { maxTokens: config.maxBriefTokens } : undefined,
            );

            const includedDurableIds = [
              ...state.injectedDurableIds,
              ...sessionBrief.includedDurableIds,
            ];
            const includedEventIds = [...state.injectedEventIds, ...sessionBrief.includedEventIds];
            const sections: Array<{ name: string; text: string }> = [];
            if (sessionBrief.injected) {
              sections.push({ name: 'session-start', text: sessionBrief.text });
            }

            if (prompt && !isNoisyPrompt(prompt)) {
              const recallBrief = buildPromptRecallBrief(
                prompt,
                { db, projectRoot, now: nowMs },
                {
                  ...(config.maxBriefTokens ? { maxTokens: config.maxBriefTokens } : {}),
                  alreadyInjectedDurableIds: includedDurableIds,
                  alreadyInjectedEventIds: includedEventIds,
                },
              );
              if (recallBrief.injected) {
                sections.push({ name: 'prompt-recall', text: recallBrief.text });
                includedDurableIds.push(...recallBrief.includedDurableIds);
                includedEventIds.push(...recallBrief.includedEventIds);
              }
            }

            return { sections, includedDurableIds, includedEventIds };
          } finally {
            try {
              db.close();
            } catch {
              // Ignore SQLite close error
            }
          }
        });

        const startEvent: InboxEvent = {
          version: 1,
          event_id: deterministicEventId(`dsh:${sessionId}:session_start`),
          source: 'dsh',
          source_event_id: `dsh:${sessionId}:session_start`,
          project_root: projectRoot,
          session_id: sessionId,
          timestamp: nowMs,
          kind: 'session_start',
          payload: {
            tool: 'dsh',
            ...(modelName ? { model: modelName } : {}),
          },
        };
        try {
          writeInboxEvent(inboxDir, startEvent);
          dirtyProjects.add(projectRoot);
        } catch {
          // Best-effort inbox write
        }

        writeHookSessionState(
          'dsh',
          {
            sessionId,
            sessionStartInjected: true,
            ...(promptHash ? { lastPromptHash: promptHash } : {}),
            injectedDurableIds: result.includedDurableIds,
            injectedEventIds: result.includedEventIds,
            updatedAt: nowMs,
          },
          env,
        );

        if (result.sections.length === 0) {
          return decision;
        }

        const combinedText = result.sections.map((section) => section.text).join('\n\n');
        return {
          ...decision,
          messages: [
            ...decision.messages,
            createLocusContextMessage(combinedText, result.sections),
          ],
        };
      }

      if (!prompt) {
        return decision;
      }

      const promptHash = hashPrompt(prompt);
      if (state.lastPromptHash === promptHash) {
        return decision;
      }

      if (isNoisyPrompt(prompt)) {
        writeHookSessionState(
          'dsh',
          {
            ...state,
            lastPromptHash: promptHash,
            updatedAt: nowMs,
          },
          env,
        );
        return decision;
      }

      const { dbPath } = resolveProjectPaths(projectRoot);
      const brief = await runSerialized(projectRoot, async () => {
        const { db } = await initStorage(dbPath);
        try {
          return buildPromptRecallBrief(
            prompt,
            { db, projectRoot, now: nowMs },
            {
              ...(config.maxBriefTokens ? { maxTokens: config.maxBriefTokens } : {}),
              alreadyInjectedDurableIds: state.injectedDurableIds,
              alreadyInjectedEventIds: state.injectedEventIds,
            },
          );
        } finally {
          try {
            db.close();
          } catch {
            // Ignore SQLite close error
          }
        }
      });

      writeHookSessionState(
        'dsh',
        {
          sessionId,
          sessionStartInjected: state.sessionStartInjected,
          lastPromptHash: promptHash,
          injectedDurableIds: brief.injected
            ? [...state.injectedDurableIds, ...brief.includedDurableIds]
            : state.injectedDurableIds,
          injectedEventIds: brief.injected
            ? [...state.injectedEventIds, ...brief.includedEventIds]
            : state.injectedEventIds,
          updatedAt: nowMs,
        },
        env,
      );

      if (!brief.injected) {
        return decision;
      }

      return {
        ...decision,
        messages: [
          ...decision.messages,
          createLocusContextMessage(brief.text, [{ name: 'prompt-recall', text: brief.text }]),
        ],
      };
    } catch (error) {
      ctx.logger?.warn?.(
        `locus-memory: pre-step failed open: ${error instanceof Error ? error.message : String(error)}`,
      );
      return decision;
    }
  });

  ctx.on('tools/result', (exec: DshToolExec, result: DshToolResult) => {
    try {
      const session = exec.agent?.session;
      if (!session) {
        return;
      }
      const toolName = stringField(exec.name);
      if (!toolName || isLocusToolName(toolName)) {
        return;
      }

      const isError = result.isError === true;
      const lowerTool = toolName.toLowerCase();
      const shouldCapture =
        isError || (CAPTURED_TOOLS.has(lowerTool) && !READ_ONLY_TOOLS.has(lowerTool));
      if (!shouldCapture) {
        return;
      }

      const gate = evaluateHookWorkspace({
        rawCwd: resolveSessionRawCwd(ctx, session),
        env,
      });
      if (!gate.allowed) {
        return;
      }

      const projectRoot = gate.projectRoot;
      const sessionId = resolveSessionId(session);
      const timestamp = now();
      const callId = stringField(exec.callId);
      const sourceEventId = callId
        ? `dsh:${sessionId}:tool:${callId}`
        : `dsh:${sessionId}:tool:${timestamp}:${toolName}`;
      const files = extractCandidateFilesFromArgs(exec.arguments);

      const event: InboxEvent = {
        version: 1,
        event_id: deterministicEventId(`${sourceEventId}:tool_use`),
        source: 'dsh',
        source_event_id: sourceEventId,
        project_root: projectRoot,
        session_id: sessionId,
        timestamp,
        kind: 'tool_use',
        payload: {
          tool: toolName,
          files,
          status: isError ? 'error' : 'success',
        },
      };

      writeInboxEvent(resolveProjectPaths(projectRoot).inboxDir, event);
      dirtyProjects.add(projectRoot);
    } catch (error) {
      ctx.logger?.warn?.(
        `locus-memory: tools/result capture failed open: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  ctx.on('session/event', (session: DshSession, event: DshSessionEvent) => {
    try {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
        return;
      }

      const gate = evaluateHookWorkspace({
        rawCwd: resolveSessionRawCwd(ctx, session),
        env,
      });
      if (!gate.allowed) {
        return;
      }

      const projectRoot = gate.projectRoot;
      const sessionId = resolveSessionId(session);
      const eventNowMs =
        typeof event.time === 'number' && Number.isSafeInteger(event.time) && event.time > 0
          ? event.time
          : now();

      if (event.type === 'turn/end') {
        void flushProject(projectRoot, eventNowMs).catch((error) => {
          ctx.logger?.warn?.(
            `locus-memory: turn/end flush failed open: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        return;
      }

      if (captureLevel === 'metadata') {
        return;
      }

      const seq =
        typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
          ? event.seq
          : nextSyntheticSeq(sessionId);
      const sourceEventId = `dsh:${sessionId}:seq:${seq}`;
      const inboxDir = resolveProjectPaths(projectRoot).inboxDir;

      if (event.type === 'user/message' && isPlainObject(event.data)) {
        const source = isPlainObject(event.data.source) ? event.data.source : undefined;
        if (source?.kind !== 'user') {
          return;
        }
        const cleaned = sanitizeDshText(extractTextFromContent(event.data.content));
        if (!cleaned || isNoisyPrompt(cleaned)) {
          return;
        }

        const sanitized = truncateText(redact(cleaned).trim(), maxChars).trim();
        if (!sanitized) {
          return;
        }

        const payload: Record<string, unknown> = { prompt: sanitized };
        if (captureLevel === 'redacted') {
          payload.capture_policy = 'bounded_redacted';
        }

        writeInboxEvent(inboxDir, {
          version: 1,
          event_id: deterministicEventId(`${sourceEventId}:user_prompt`),
          source: 'dsh',
          source_event_id: sourceEventId,
          project_root: projectRoot,
          session_id: sessionId,
          timestamp: eventNowMs,
          kind: 'user_prompt',
          payload,
        });
        dirtyProjects.add(projectRoot);
        return;
      }

      if (event.type === 'assistant/message' && isPlainObject(event.data)) {
        const messageObj = isPlainObject(event.data.message) ? event.data.message : event.data;
        const cleaned = sanitizeDshText(extractTextFromContent(messageObj.content));
        if (!cleaned) {
          return;
        }

        const sanitized = truncateText(redact(cleaned).trim(), maxChars).trim();
        if (!sanitized) {
          return;
        }

        const payload: Record<string, unknown> = { response: sanitized };
        const messageSource = isPlainObject(messageObj.source) ? messageObj.source : undefined;
        const modelName = stringField(messageSource?.model);
        if (modelName) {
          payload.model = modelName;
        }
        if (captureLevel === 'redacted') {
          payload.capture_policy = 'bounded_redacted';
        }

        writeInboxEvent(inboxDir, {
          version: 1,
          event_id: deterministicEventId(`${sourceEventId}:ai_response`),
          source: 'dsh',
          source_event_id: sourceEventId,
          project_root: projectRoot,
          session_id: sessionId,
          timestamp: eventNowMs,
          kind: 'ai_response',
          payload,
        });
        dirtyProjects.add(projectRoot);
      }
    } catch (error) {
      ctx.logger?.warn?.(
        `locus-memory: session/event capture failed open: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  const flushAll = async (): Promise<void> => {
    const roots = new Set<string>([...dirtyProjects, ...projectQueues.keys()]);
    await Promise.all([...roots].map((root) => flushProject(root)));
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        void flushAll().catch(() => {
          // Best-effort flush on plugin dispose
        });
      },
      'locus-memory.flush',
    );
  }

  return { flushAll };
}

export function apply(ctx: DshContext, config: LocusDshPluginConfig = {}): void {
  applyLocusDshPlugin(ctx, config);
}
