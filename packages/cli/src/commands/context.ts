import {
  buildPromptRecallBrief,
  buildSessionStartBrief,
  type CaptureLevel,
  initStorage,
  processInbox,
  resolveProjectRoot,
  runDurableExtraction,
} from '@locus/core';
import { resolveDbPath, resolveInboxDir } from '@locus/shared-runtime';

export interface RunContextCommandOptions {
  mode?: string;
  prompt?: string;
  cwd?: string;
  json?: boolean;
  maxTokens?: number;
  env?: Record<string, string | undefined>;
}

export interface RunContextCommandResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

function resolveCaptureLevel(env: Record<string, string | undefined>): CaptureLevel {
  const raw = env.LOCUS_CAPTURE_LEVEL;
  if (raw === 'metadata' || raw === 'redacted' || raw === 'full') {
    return raw;
  }
  return 'metadata';
}

function withScopedEnv<T>(
  overrides: Record<string, string | undefined> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!overrides) {
    return fn();
  }

  const savedEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

export async function runContextCommand(
  options: RunContextCommandOptions = {},
): Promise<RunContextCommandResult> {
  const mode = options.mode ?? 'session-start';
  if (mode !== 'session-start' && mode !== 'prompt') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unsupported context mode: ${mode}. Expected "session-start" or "prompt".`,
    };
  }

  if (mode === 'prompt' && (!options.prompt || options.prompt.trim().length === 0)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Option --prompt <text> is required when --mode prompt is used.',
    };
  }

  if (
    options.maxTokens !== undefined &&
    (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)
  ) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Option --max-tokens must be a positive integer.',
    };
  }

  return withScopedEnv(options.env, async () => {
    const cwd = options.cwd?.trim() || process.cwd();
    const { root: projectRoot } = resolveProjectRoot(cwd);
    const dbPath = resolveDbPath(projectRoot);
    const inboxDir = resolveInboxDir(projectRoot);
    const captureLevel = resolveCaptureLevel(process.env);

    const { db, fts5 } = await initStorage(dbPath);
    try {
      try {
        processInbox(inboxDir, db, {
          batchLimit: 50,
          captureLevel,
          fts5Available: fts5,
          projectRoot,
        });
        runDurableExtraction(db);
      } catch {
        // Best-effort sync before brief generation
      }

      const brief =
        mode === 'session-start'
          ? buildSessionStartBrief(
              { db, projectRoot },
              options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : undefined,
            )
          : buildPromptRecallBrief(
              options.prompt ?? '',
              { db, projectRoot },
              options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : undefined,
            );

      const stdout = options.json ? JSON.stringify(brief) : brief.injected ? brief.text : '';
      return {
        exitCode: 0,
        stdout,
      };
    } finally {
      try {
        db.close();
      } catch {
        // Ignore close errors on cleanup
      }
    }
  });
}
