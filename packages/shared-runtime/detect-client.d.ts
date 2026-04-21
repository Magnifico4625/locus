export type ClientEnv = 'claude-code' | 'codex' | 'generic';
export type ClientSurface = 'cli' | 'desktop' | 'extension' | 'generic';

export interface ClientRuntime {
  client: ClientEnv;
  surface: ClientSurface;
  detected: boolean;
  evidence: string[];
}

export function detectClientRuntime(
  env?: Record<string, string | undefined>,
  argv?: readonly string[],
  cwd?: string,
): ClientRuntime;
export function detectClientEnv(): ClientEnv;
