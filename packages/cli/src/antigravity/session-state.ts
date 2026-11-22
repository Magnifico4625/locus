import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeFileAtomically } from '../runtime-install.js';
import { resolveAntigravitySessionStatePath } from './paths.js';

export interface AntigravitySessionState {
  conversationId: string;
  sessionStartInjected: boolean;
  lastPromptHash?: string;
  injectedDurableIds: number[];
  injectedEventIds: string[];
  updatedAt: number;
}

const MAX_TRACKED_IDS = 200;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function emptySessionState(conversationId: string): AntigravitySessionState {
  return {
    conversationId,
    sessionStartInjected: false,
    injectedDurableIds: [],
    injectedEventIds: [],
    updatedAt: 0,
  };
}

function dedupeRecentNumbers(values: readonly unknown[]): number[] {
  const seen = new Set<number>();
  for (const item of values) {
    if (typeof item === 'number' && Number.isInteger(item) && item > 0) {
      seen.add(item);
    }
  }
  const result = Array.from(seen);
  return result.length > MAX_TRACKED_IDS ? result.slice(-MAX_TRACKED_IDS) : result;
}

function dedupeRecentStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const item of values) {
    if (typeof item === 'string' && item.length > 0) {
      seen.add(item);
    }
  }
  const result = Array.from(seen);
  return result.length > MAX_TRACKED_IDS ? result.slice(-MAX_TRACKED_IDS) : result;
}

export function hashPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function readAntigravitySessionState(
  conversationId: string,
  env: Record<string, string | undefined> = process.env,
): AntigravitySessionState {
  const filePath = resolveAntigravitySessionStatePath(conversationId, env);
  if (!existsSync(filePath)) {
    return emptySessionState(conversationId);
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<AntigravitySessionState>;
    return {
      conversationId,
      sessionStartInjected: parsed.sessionStartInjected === true,
      lastPromptHash:
        typeof parsed.lastPromptHash === 'string' && parsed.lastPromptHash.length > 0
          ? parsed.lastPromptHash
          : undefined,
      injectedDurableIds: Array.isArray(parsed.injectedDurableIds)
        ? dedupeRecentNumbers(parsed.injectedDurableIds)
        : [],
      injectedEventIds: Array.isArray(parsed.injectedEventIds)
        ? dedupeRecentStrings(parsed.injectedEventIds)
        : [],
      updatedAt:
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    return emptySessionState(conversationId);
  }
}

export function writeAntigravitySessionState(
  state: AntigravitySessionState,
  env: Record<string, string | undefined> = process.env,
): void {
  const filePath = resolveAntigravitySessionStatePath(state.conversationId, env);
  const normalized: AntigravitySessionState = {
    conversationId: state.conversationId,
    sessionStartInjected: state.sessionStartInjected,
    ...(state.lastPromptHash ? { lastPromptHash: state.lastPromptHash } : {}),
    injectedDurableIds: dedupeRecentNumbers(state.injectedDurableIds),
    injectedEventIds: dedupeRecentStrings(state.injectedEventIds),
    updatedAt: state.updatedAt,
  };

  writeFileAtomically(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  pruneStaleSessionStateFiles(dirname(filePath), basename(filePath), normalized.updatedAt);
}

function pruneStaleSessionStateFiles(
  stateDir: string,
  currentFileName: string,
  nowMs: number,
): void {
  if (!Number.isFinite(nowMs) || nowMs <= STATE_TTL_MS) {
    return;
  }

  try {
    const cutoff = nowMs - STATE_TTL_MS;
    for (const entry of readdirSync(stateDir)) {
      if (entry === currentFileName || !entry.endsWith('.json')) {
        continue;
      }
      const entryPath = join(stateDir, entry);
      try {
        const stats = statSync(entryPath);
        if (stats.mtimeMs < cutoff) {
          rmSync(entryPath, { force: true });
        }
      } catch {
        // Ignore individual prune failures
      }
    }
  } catch {
    // Ignore directory read errors during best-effort cleanup
  }
}
