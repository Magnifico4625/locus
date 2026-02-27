import { createHash } from 'node:crypto';
import { normalize } from 'node:path';

export function projectHash(projectRoot: string): string {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sanitizes a user query for FTS5 MATCH syntax.
 * Wraps each word in double quotes to treat special chars (dots, hyphens, etc.) as literals.
 */
export function sanitizeFtsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
}
