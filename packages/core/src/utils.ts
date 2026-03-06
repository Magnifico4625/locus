// Re-export from shared-runtime (single source of truth)
export { projectHash } from '@locus/shared-runtime';

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
