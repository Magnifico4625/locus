import type { SemanticMemory } from '../memory/semantic.js';
import type { DatabaseAdapter, ExportEntry, SearchResult } from '../types.js';

export interface SearchDeps {
  db: DatabaseAdapter;
  semantic: SemanticMemory;
  fts5: boolean;
}

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

function parseExports(json: string | null): ExportEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as ExportEntry[];
  } catch {
    return [];
  }
}

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

export function handleSearch(query: string, deps: SearchDeps): SearchResult[] {
  const { db, semantic } = deps;

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

  // Combine, sort by relevance DESC, limit to 20
  const combined = [...structural, ...semanticResults, ...episodic];
  combined.sort((a, b) => b.relevance - a.relevance);

  return combined.slice(0, 20);
}
