import type { DurableMemoryType } from '../types.js';

export interface TopicKeyInput {
  memoryType: DurableMemoryType;
  summary: string;
}

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9]+/gi, ' ').trim();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function deriveTopicKey(input: TopicKeyInput): string | undefined {
  if (input.memoryType !== 'decision') {
    return undefined;
  }

  const normalized = normalizeSummary(input.summary);

  if (
    includesAny(normalized, ['sqlite', 'postgresql', 'postgres', 'mysql']) &&
    includesAny(normalized, ['database', 'store', 'memory'])
  ) {
    return 'database_choice';
  }

  if (
    includesAny(normalized, ['oauth', 'github oauth', 'auth strategy', 'authentication strategy']) &&
    includesAny(normalized, ['auth', 'authentication', 'login'])
  ) {
    return 'auth_strategy';
  }

  return undefined;
}
