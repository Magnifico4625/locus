import type { DatabaseAdapter } from '../types.js';

const MAX_ENTRIES = 15;
const MAX_LINE_CHARS = 100;

interface MemoryRow {
  content: string;
  updated_at: number;
}

export function generateDecisions(db: DatabaseAdapter): string {
  const totalRow = db.get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM memories WHERE layer = 'semantic'",
  );
  const total = totalRow?.total ?? 0;

  if (total === 0) {
    return 'No decisions recorded yet.';
  }

  const rows = db.all<MemoryRow>(
    "SELECT content, updated_at FROM memories WHERE layer = 'semantic' ORDER BY updated_at DESC LIMIT ?",
    [MAX_ENTRIES],
  );

  const lines: string[] = rows.map((row) => {
    const content =
      row.content.length > MAX_LINE_CHARS
        ? `${row.content.slice(0, MAX_LINE_CHARS)}...`
        : row.content;
    return `- ${content}`;
  });

  const older = total - rows.length;
  if (older > 0) {
    lines.push(`  (+${older} older — use memory_search)`);
  }

  return lines.join('\n');
}
