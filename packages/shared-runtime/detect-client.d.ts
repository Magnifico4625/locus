export type ClientEnv = 'claude-code' | 'codex' | 'generic';
export function detectClientEnv(): ClientEnv;
