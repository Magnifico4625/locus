import type { SemanticMemory } from '../memory/semantic.js';
import type { DatabaseAdapter, EventKind, ExportEntry, SearchResult, TimeRange } from '../types.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface SearchDeps {
  db: DatabaseAdapter;
  semantic: SemanticMemory;
  fts5: boolean;
}

export interface SearchOptions {
  timeRange?: TimeRange;
  filePath?: string;
  kind?: EventKind;
  source?: string;
  limit?: number;
  offset?: number;
}

// ─── Internal row types ───────────────────────────────────────────────────────

interface FileRow {
  relative_path: string;
  exports_json: string | null;
  imports_json: string | null;
  re_exports_json: string | null;
  file_type: string | null;
  language: string | null;
  lines: number;
  confidence_level: string | null;
  confidence_reason: string | null;
  last_scanned: number;
  skipped_reason: string | null;
}

interface EpisodicRow {
  id: number;
  layer: string;
  content: string;
  tags_json: string | null;
  created_at: number;
  updated_at: number;
  session_id: string | null;
}

interface ConversationFtsRow {
  id: number;
  event_id: string;
  kind: string;
  payload_json: string | null;
  timestamp: number;
  significance: string | null;
  session_id: string | null;
  fts_rank: number;
}

interface ConversationLikeRow {
  id: number;
  event_id: string;
  kind: string;
  payload_json: string | null;
  timestamp: number;
  significance: string | null;
  session_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseExports(json: string | null): ExportEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as ExportEntry[];
  } catch {
    return [];
  }
}

/**
 * Sanitizes a user query for FTS5 MATCH syntax.
 * Wraps each word in double quotes to treat special chars as literals.
 */
function sanitizeFtsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
}

/**
 * Extracts a human-readable summary from the conversation event payload.
 */
export function summarizePayload(kind: string, payloadJson: string | null): string {
  if (!payloadJson) return kind;
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    switch (kind) {
      case 'user_prompt': {
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        return prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
      }
      case 'ai_response': {
        const response = typeof payload.response === 'string' ? payload.response : '';
        return response.length > 120 ? `${response.slice(0, 117)}...` : response;
      }
      case 'tool_use': {
        const tool = typeof payload.tool === 'string' ? payload.tool : '';
        const files = Array.isArray(payload.files) ? payload.files : [];
        const status = typeof payload.status === 'string' ? payload.status : '';
        const fileStr = files.length > 0 ? ` [${files.join(', ')}]` : '';
        return `${tool}${fileStr} (${status})`;
      }
      case 'file_diff': {
        const path = typeof payload.path === 'string' ? payload.path : '';
        const added = typeof payload.added === 'number' ? payload.added : 0;
        const removed = typeof payload.removed === 'number' ? payload.removed : 0;
        return `${path} (+${added}/-${removed})`;
      }
      case 'session_start': {
        const tool = typeof payload.tool === 'string' ? payload.tool : '';
        return `session_start: ${tool}`;
      }
      case 'session_end': {
        const summary = typeof payload.summary === 'string' ? payload.summary : '';
        return summary ? `session_end: ${summary}` : 'session_end';
      }
      default:
        return kind;
    }
  } catch {
    return kind;
  }
}

// ─── Time Range Resolution ────────────────────────────────────────────────────

interface ResolvedTimeRange {
  from: number;
  to: number;
}

/**
 * Converts a TimeRange (possibly with relative strings) into absolute timestamps.
 */
export function resolveTimeRange(range: TimeRange): ResolvedTimeRange {
  const now = Date.now();

  if (range.relative) {
    switch (range.relative) {
      case 'today': {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return { from: start.getTime(), to: now };
      }
      case 'yesterday': {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        return { from: startOfYesterday.getTime(), to: startOfToday.getTime() };
      }
      case 'this_week': {
        const monday = new Date();
        const dayOfWeek = monday.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        monday.setDate(monday.getDate() - diff);
        monday.setHours(0, 0, 0, 0);
        return { from: monday.getTime(), to: now };
      }
      case 'last_7d':
        return { from: now - 7 * 24 * 3600 * 1000, to: now };
      case 'last_30d':
        return { from: now - 30 * 24 * 3600 * 1000, to: now };
    }
  }

  return {
    from: range.from ?? 0,
    to: range.to ?? now,
  };
}

// ─── Structural Search ────────────────────────────────────────────────────────

function searchStructural(query: string, db: DatabaseAdapter): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  const files = db.all<FileRow>('SELECT * FROM files');

  for (const file of files) {
    const exports = parseExports(file.exports_json);

    // Check export names (case-insensitive) — relevance 1.0
    let exportMatched = false;
    for (const exp of exports) {
      if (exp.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          layer: 'structural',
          content: `${file.relative_path} -> ${exp.name}()`,
          relevance: 1.0,
          source: file.relative_path,
        });
        exportMatched = true;
      }
    }

    // Check file path (case-insensitive) — relevance 0.5, only if no export match already
    if (!exportMatched && file.relative_path.toLowerCase().includes(lowerQuery)) {
      results.push({
        layer: 'structural',
        content: file.relative_path,
        relevance: 0.5,
        source: file.relative_path,
      });
    }
  }

  return results;
}

// ─── Episodic Search ──────────────────────────────────────────────────────────

function searchEpisodic(query: string, db: DatabaseAdapter): SearchResult[] {
  const lowerQuery = query.toLowerCase();
  const rows = db.all<EpisodicRow>(
    "SELECT * FROM memories WHERE layer='episodic' AND content LIKE ? ORDER BY updated_at DESC",
    [`%${lowerQuery}%`],
  );

  return rows.map((row) => ({
    layer: 'episodic' as const,
    content: row.content,
    relevance: 0.6,
    source: `session:${row.session_id ?? 'unknown'}`,
  }));
}

// ─── Conversation Search ──────────────────────────────────────────────────────

function buildWhereClause(
  resolved: ResolvedTimeRange | undefined,
  kind: EventKind | undefined,
  source: string | undefined,
  filePath: string | undefined,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (resolved) {
    clauses.push('ce.timestamp >= ?');
    params.push(resolved.from);
    clauses.push('ce.timestamp <= ?');
    params.push(resolved.to);
  }

  if (kind) {
    clauses.push('ce.kind = ?');
    params.push(kind);
  }

  if (source) {
    clauses.push('ce.source = ?');
    params.push(source);
  }

  if (filePath) {
    clauses.push('ce.event_id IN (SELECT event_id FROM event_files WHERE file_path = ?)');
    params.push(filePath);
  }

  return { clauses, params };
}

function searchConversationFts(
  query: string,
  db: DatabaseAdapter,
  resolved: ResolvedTimeRange | undefined,
  opts: { kind?: EventKind; source?: string; filePath?: string; limit: number; offset: number },
): SearchResult[] {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  const { clauses, params } = buildWhereClause(resolved, opts.kind, opts.source, opts.filePath);

  const whereStr = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT ce.id, ce.event_id, ce.kind, ce.payload_json, ce.timestamp,
           ce.significance, ce.session_id,
           rank AS fts_rank
    FROM conversation_fts
    JOIN conversation_events ce ON ce.id = conversation_fts.rowid
    WHERE conversation_fts MATCH ?
    ${whereStr}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;

  const allParams = [ftsQuery, ...params, opts.limit, opts.offset];

  let rows: ConversationFtsRow[];
  try {
    rows = db.all<ConversationFtsRow>(sql, allParams);
  } catch {
    return [];
  }

  return scoreConversationResults(rows);
}

function searchConversationLike(
  query: string,
  db: DatabaseAdapter,
  resolved: ResolvedTimeRange | undefined,
  opts: { kind?: EventKind; source?: string; filePath?: string; limit: number; offset: number },
): SearchResult[] {
  const { clauses, params } = buildWhereClause(resolved, opts.kind, opts.source, opts.filePath);

  clauses.push('ce.payload_json LIKE ?');
  params.push(`%${query}%`);

  const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT ce.id, ce.event_id, ce.kind, ce.payload_json, ce.timestamp,
           ce.significance, ce.session_id
    FROM conversation_events ce
    ${whereStr}
    ORDER BY ce.timestamp DESC
    LIMIT ? OFFSET ?
  `;

  const allParams = [...params, opts.limit, opts.offset];

  let rows: ConversationLikeRow[];
  try {
    rows = db.all<ConversationLikeRow>(sql, allParams);
  } catch {
    return [];
  }

  // Assign relevance based on recency (no FTS rank available)
  if (rows.length === 0) return [];

  const timestamps = rows.map((r) => r.timestamp);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const range = maxTs - minTs;

  return rows.map((row) => {
    const recency = range > 0 ? (row.timestamp - minTs) / range : 1.0;
    const relevance = 0.5 + 0.2 * recency; // Base 0.5 + recency bonus

    return {
      layer: 'conversation' as const,
      content: summarizePayload(row.kind, row.payload_json),
      relevance: Math.round(relevance * 100) / 100,
      source: `${row.kind}:${row.event_id}`,
    };
  });
}

/**
 * Score conversation results using BM25 + recency.
 * Score = normalized_fts + 0.2 * recency_score
 */
function scoreConversationResults(rows: ConversationFtsRow[]): SearchResult[] {
  if (rows.length === 0) return [];

  // FTS5 rank is negative — more negative = better match
  // Convert to positive: -rank
  const scores = rows.map((r) => -r.fts_rank);
  const maxScore = Math.max(...scores);

  const timestamps = rows.map((r) => r.timestamp);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const tsRange = maxTs - minTs;

  return rows.map((row, i) => {
    const rawScore = scores[i] ?? 0;
    const ftsNormalized = maxScore > 0 ? rawScore / maxScore : 1.0;
    const recency = tsRange > 0 ? (row.timestamp - minTs) / tsRange : 1.0;
    const relevance = ftsNormalized + 0.2 * recency;

    return {
      layer: 'conversation' as const,
      content: summarizePayload(row.kind, row.payload_json),
      relevance: Math.round(relevance * 100) / 100,
      source: `${row.kind}:${row.event_id}`,
    };
  });
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function handleSearch(
  query: string,
  deps: SearchDeps,
  options?: SearchOptions,
): SearchResult[] {
  const { db, semantic, fts5 } = deps;
  const convLimit = options?.limit ?? 20;
  const convOffset = options?.offset ?? 0;

  // 1. Structural results
  const structural = searchStructural(query, db);

  // 2. Semantic results
  const semanticEntries = semantic.search(query, 10);
  const semanticResults: SearchResult[] = semanticEntries.map((entry) => ({
    layer: 'semantic' as const,
    content: entry.content,
    relevance: 0.8,
    source: `memory:${entry.id}`,
  }));

  // 3. Episodic results
  const episodic = searchEpisodic(query, db);

  // 4. Conversation results (new in v3)
  let conversation: SearchResult[] = [];
  const resolved = options?.timeRange ? resolveTimeRange(options.timeRange) : undefined;
  const convOpts = {
    kind: options?.kind,
    source: options?.source,
    filePath: options?.filePath,
    limit: convLimit,
    offset: convOffset,
  };

  if (fts5) {
    conversation = searchConversationFts(query, db, resolved, convOpts);
  } else {
    conversation = searchConversationLike(query, db, resolved, convOpts);
  }

  // Combine, sort by relevance DESC, limit to 20
  const combined = [...structural, ...semanticResults, ...episodic, ...conversation];
  combined.sort((a, b) => b.relevance - a.relevance);

  return combined.slice(0, 20);
}
