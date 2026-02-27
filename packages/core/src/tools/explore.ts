import type { DatabaseAdapter, ExportEntry, ImportEntry, ReExportEntry } from '../types.js';

export interface ExploreDeps {
  db: DatabaseAdapter;
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

function basename(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash === -1 ? relativePath : relativePath.slice(slash + 1);
}

function parseExports(json: string | null): ExportEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as ExportEntry[];
  } catch {
    return [];
  }
}

function parseImports(json: string | null): ImportEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as ImportEntry[];
  } catch {
    return [];
  }
}

function parseReExports(json: string | null): ReExportEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as ReExportEntry[];
  } catch {
    return [];
  }
}

function formatReExportName(entry: ReExportEntry): string {
  if (entry.names === '*') {
    return `* from ${entry.source}`;
  }
  return entry.names.map((n) => `${n} from ${entry.source}`).join(', ');
}

function formatFile(row: FileRow): string {
  const name = basename(row.relative_path);
  const exports = parseExports(row.exports_json);
  const imports = parseImports(row.imports_json);
  const reExports = parseReExports(row.re_exports_json);
  const confidence = row.confidence_level ?? 'unknown';

  const lines: string[] = [];

  if (exports.length > 0) {
    const exportNames = exports.map((e) => e.name).join(', ');
    const importSources = imports.map((i) => i.source).join(', ');
    const prefix = `${name}:`;
    const exportsStr = `exports [${exportNames}]  confidence: ${confidence}`;
    lines.push(`${prefix.padEnd(14)}${exportsStr}`);
    if (importSources) {
      lines.push(`${''.padEnd(14)}imports [${importSources}]`);
    }
  } else if (reExports.length > 0) {
    const reExportNames = reExports.map(formatReExportName).join(', ');
    const prefix = `${name}:`;
    lines.push(`${prefix.padEnd(14)}re-exports [${reExportNames}]  confidence: ${confidence}`);
    const importSources = imports.map((i) => i.source).join(', ');
    if (importSources) {
      lines.push(`${''.padEnd(14)}imports [${importSources}]`);
    }
  } else {
    const importSources = imports.map((i) => i.source).join(', ');
    const prefix = `${name}:`;
    const exportsStr = `exports []  confidence: ${confidence}`;
    lines.push(`${prefix.padEnd(14)}${exportsStr}`);
    if (importSources) {
      lines.push(`${''.padEnd(14)}imports [${importSources}]`);
    }
  }

  return lines.join('\n');
}

export function handleExplore(path: string, deps: ExploreDeps): string {
  const { db } = deps;

  // Normalise: strip leading/trailing slashes, treat "/" and "" as root
  const normalised = path.replace(/^\/+|\/+$/g, '');

  let rows: FileRow[];

  if (normalised === '') {
    // Root level: files with no directory component
    rows = db.all<FileRow>(
      "SELECT * FROM files WHERE relative_path NOT LIKE '%/%' ORDER BY relative_path",
    );
  } else {
    // Direct children only: LIKE 'prefix/%' but NOT LIKE 'prefix/%/%'
    rows = db.all<FileRow>(
      'SELECT * FROM files WHERE relative_path LIKE ? AND relative_path NOT LIKE ? ORDER BY relative_path',
      [`${normalised}/%`, `${normalised}/%/%`],
    );
  }

  if (rows.length === 0) {
    const displayPath = normalised === '' ? '/' : normalised;
    return `No files found in ${displayPath}`;
  }

  return rows.map(formatFile).join('\n');
}
