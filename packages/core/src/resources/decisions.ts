import type { DatabaseAdapter } from '../types.js';

const MAX_ENTRIES = 15;
const MAX_LINE_CHARS = 100;

interface MemoryRow {
  content: string;
  updated_at: number;
}

interface DurableDecisionRow {
  summary: string;
  updated_at: number;
}

export function generateDecisions(db: DatabaseAdapter): string {
  const durableTotalRow = db.get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM durable_memories WHERE memory_type = 'decision' AND state = 'active'",
  );
  const durableTotal = durableTotalRow?.total ?? 0;

  if (durableTotal > 0) {
    const durableRows = db.all<DurableDecisionRow>(
      `SELECT summary, updated_at
       FROM durable_memories
       WHERE memory_type = 'decision' AND state = 'active'
       ORDER BY updated_at DESC
       LIMIT ?`,
      [MAX_ENTRIES],
    );

    return formatDecisionLines(
      durableRows.map((row) => row.summary),
      durableTotal,
    );
  }

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

  return formatDecisionLines(
    rows.map((row) => row.content),
    total,
  );
}

function formatDecisionLines(entries: string[], total: number): string {
  const lines: string[] = entries.map((entry) => {
    const content = entry.length > MAX_LINE_CHARS ? `${entry.slice(0, MAX_LINE_CHARS)}...` : entry;
    return `- ${content}`;
  });

  const older = total - entries.length;
  if (older > 0) {
    lines.push(`  (+${older} older — use memory_search)`);
  }

  return lines.join('\n');
}
