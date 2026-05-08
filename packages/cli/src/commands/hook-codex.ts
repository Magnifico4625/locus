import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCodexHome } from '../codex/paths.js';

export type CodexHookEvent = 'session-start' | 'user-prompt-submit' | 'stop';

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

const supportedEvents = new Set<CodexHookEvent>(['session-start', 'user-prompt-submit', 'stop']);

export function runCodexHook(options: RunCodexHookOptions): CodexHookResult {
  const event = options.event;
  if (!isSupportedEvent(event)) {
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
      stdout: JSON.stringify({ continue: true, suppressOutput: true }),
      stderr: 'malformed Codex hook input; failing open',
    };
  }

  if (event === 'stop') {
    const writeResult = writeStopTrigger({
      env: options.env,
      input: parsed.value,
      now: options.now ?? new Date(),
    });
    if (!writeResult.ok) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ continue: true, suppressOutput: true }),
        stderr: `could not write Codex hook trigger; failing open: ${writeResult.error.message}`,
      };
    }
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify({ continue: true, suppressOutput: true }),
  };
}

function isSupportedEvent(event: string | undefined): event is CodexHookEvent {
  return typeof event === 'string' && supportedEvents.has(event as CodexHookEvent);
}

function parseHookInput(stdin: string | undefined):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false } {
  if (!stdin || stdin.trim().length === 0) {
    return { ok: true, value: {} };
  }

  try {
    const value = JSON.parse(stdin) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: true, value: {} };
  } catch {
    return { ok: false };
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

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
