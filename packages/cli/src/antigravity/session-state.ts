import {
  type HookSessionState,
  hashPrompt,
  readHookSessionState,
  writeHookSessionState,
} from '../hook-session-state.js';

export interface AntigravitySessionState {
  conversationId: string;
  sessionStartInjected: boolean;
  lastPromptHash?: string;
  injectedDurableIds: number[];
  injectedEventIds: string[];
  updatedAt: number;
}

export { hashPrompt };

function toAntigravityState(state: HookSessionState): AntigravitySessionState {
  return {
    conversationId: state.sessionId,
    sessionStartInjected: state.sessionStartInjected,
    ...(state.lastPromptHash ? { lastPromptHash: state.lastPromptHash } : {}),
    injectedDurableIds: state.injectedDurableIds,
    injectedEventIds: state.injectedEventIds,
    updatedAt: state.updatedAt,
  };
}

export function readAntigravitySessionState(
  conversationId: string,
  env: Record<string, string | undefined> = process.env,
): AntigravitySessionState {
  return toAntigravityState(readHookSessionState('antigravity', conversationId, env));
}

export function writeAntigravitySessionState(
  state: AntigravitySessionState,
  env: Record<string, string | undefined> = process.env,
): void {
  writeHookSessionState(
    'antigravity',
    {
      sessionId: state.conversationId,
      sessionStartInjected: state.sessionStartInjected,
      ...(state.lastPromptHash ? { lastPromptHash: state.lastPromptHash } : {}),
      injectedDurableIds: state.injectedDurableIds,
      injectedEventIds: state.injectedEventIds,
      updatedAt: state.updatedAt,
    },
    env,
  );
}
