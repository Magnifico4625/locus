import type { CaptureLevel } from '@locus/core';

export interface DshContentBlock {
  type?: string;
  text?: string;
}

export interface DshMessageSource {
  kind?: string;
  provider?: string;
  model?: string;
  form?: string;
  sections?: ReadonlyArray<Readonly<{ name: string; text: string }>>;
}

export interface DshMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
  content: readonly DshContentBlock[];
  source?: DshMessageSource;
}

export interface DshSessionHeader {
  id?: string;
  cwd?: string;
}

export interface DshSession {
  id: string;
  header?: DshSessionHeader;
}

export interface DshSessionEvent {
  seq?: number;
  type: string;
  time?: number;
  surfaceOp?: 'append' | 'replace';
  data?: unknown;
}

export interface DshAgent {
  id?: string;
  session: DshSession;
  options?: {
    provider?: string;
    model?: string;
  };
}

export interface DshPreStepArgs {
  agent: DshAgent;
  messages: readonly DshMessage[];
  turn: number;
  step: number;
  signal?: AbortSignal;
  modelSelection?: {
    provider?: string;
    model?: string;
  };
}

export interface DshPreStepDecision {
  kind: 'enter' | 'reject';
  messages: readonly DshMessage[];
}

export interface DshToolExec {
  name: string;
  callId?: string;
  arguments?: unknown;
  agent?: DshAgent;
  signal?: AbortSignal;
}

export interface DshToolResult {
  isError?: boolean;
}

export interface DshSystemPromptContext {
  agent?: DshAgent;
}

export interface DshSystemPromptService {
  section(section: {
    name: string;
    order: number;
    text: string | ((context?: DshSystemPromptContext) => string);
    interpolate?: boolean;
  }): void;
}

export interface DshWorkingDirectoryService {
  get(session: DshSession): string;
}

export interface DshMcpServerEntry {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface DshMcpManager {
  register(name: string, entry: DshMcpServerEntry): () => void;
}

export interface DshLogger {
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error?(message: string, ...args: unknown[]): void;
}

export interface DshContext {
  systemPrompt: DshSystemPromptService;
  workingDirectory: DshWorkingDirectoryService;
  logger?: DshLogger;
  mcpManager?: DshMcpManager;
  on(
    event: 'agent/pre-step',
    listener: (
      args: DshPreStepArgs,
      next: () => Promise<DshPreStepDecision>,
    ) => Promise<DshPreStepDecision>,
  ): void;
  on(event: 'session/event', listener: (session: DshSession, event: DshSessionEvent) => void): void;
  on(event: 'tools/result', listener: (exec: DshToolExec, result: DshToolResult) => void): void;
  effect?(callback: () => (() => void | Promise<void>) | undefined, label?: string): void;
  inject?(services: readonly string[], callback: (injectedCtx: DshContext) => void): void;
}

export interface LocusDshPluginConfig {
  captureLevel?: CaptureLevel;
  enableMcp?: boolean;
  serverPath?: string;
  maxBriefTokens?: number;
}
