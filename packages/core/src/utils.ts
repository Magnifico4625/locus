import { createHash } from 'node:crypto';
import { normalize } from 'node:path';

export function projectHash(projectRoot: string): string {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
