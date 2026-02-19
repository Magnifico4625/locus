import type { ExportEntry, ImportEntry, ReExportEntry } from '../../types.js';

// Matches: export [default] (class|function|const|...) [name]
// Groups: 1=default+space, 2=kind, 3=name (optional)
const EXPORT_DECL_RE =
  /^export\s+(default\s+)?(class|function\*?|const|let|var|type|interface|enum)\s+(\w+)?/;

// Matches: export default function() {} or export default class {} (anonymous)
const EXPORT_DEFAULT_ANON_RE = /^export\s+default\s+(function|class)[\s({]/;

// Static import: import [type] ... from 'source'
const IMPORT_STATIC_RE = /^import\s+(type\s+)?.*?\s+from\s+['"]([^'"]+)['"]/;

// Dynamic import: import('source') or await import('source')
const IMPORT_DYNAMIC_RE = /(?:^|[^.\w])import\(\s*['"]([^'"]+)['"]\s*\)/g;

// Named re-export: export [type] { ... } from 'source'
const REEXPORT_NAMED_RE = /^export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/;

// Wildcard re-export: export * [as name] from 'source'
const REEXPORT_WILDCARD_RE = /^export\s+\*\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/;

export function parseExports(code: string): ExportEntry[] {
  const results: ExportEntry[] = [];

  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();

    const declMatch = EXPORT_DECL_RE.exec(line);
    if (declMatch) {
      const isDefault = !!declMatch[1];
      // Normalise "function*" -> "function"
      const rawKind = declMatch[2]?.replace('*', '') as ExportEntry['kind'];
      const name = declMatch[3] ?? '[default]';
      const isTypeOnly = rawKind === 'type' || rawKind === 'interface';
      results.push({ name, kind: rawKind, isDefault, isTypeOnly });
      continue;
    }

    // Anonymous default: export default function() {} / export default class {}
    const anonMatch = EXPORT_DEFAULT_ANON_RE.exec(line);
    if (anonMatch) {
      const kind = anonMatch[1] as 'function' | 'class';
      results.push({ name: '[default]', kind, isDefault: true, isTypeOnly: false });
    }
  }

  return results;
}

export function parseImports(code: string): ImportEntry[] {
  const seen = new Map<string, ImportEntry>();

  // Static imports — process line by line
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    const m = IMPORT_STATIC_RE.exec(line);
    if (m) {
      const source = m[2] ?? '';
      const isTypeOnly = !!m[1];
      if (!seen.has(source)) {
        seen.set(source, { source, isTypeOnly, isDynamic: false });
      } else if (seen.get(source)?.isTypeOnly && !isTypeOnly) {
        // Prefer value import over type-only import for the same source
        seen.set(source, { source, isTypeOnly: false, isDynamic: false });
      }
    }
  }

  // Dynamic imports — scan entire code string
  IMPORT_DYNAMIC_RE.lastIndex = 0;
  for (
    let dynMatch = IMPORT_DYNAMIC_RE.exec(code);
    dynMatch !== null;
    dynMatch = IMPORT_DYNAMIC_RE.exec(code)
  ) {
    const source = dynMatch[1] ?? '';
    if (!seen.has(source)) {
      seen.set(source, { source, isTypeOnly: false, isDynamic: true });
    }
  }

  return Array.from(seen.values());
}

export function parseReExports(code: string): ReExportEntry[] {
  const results: ReExportEntry[] = [];

  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();

    // Wildcard takes priority — check before named so "export * from" is caught
    const wildMatch = REEXPORT_WILDCARD_RE.exec(line);
    if (wildMatch) {
      results.push({ source: wildMatch[1] ?? '', names: '*' });
      continue;
    }

    const namedMatch = REEXPORT_NAMED_RE.exec(line);
    if (namedMatch) {
      const rawNames = namedMatch[1] ?? '';
      const source = namedMatch[2] ?? '';
      // Each specifier may look like "foo", "foo as bar", or "type foo".
      // Keep only the original (pre-alias) name, stripping "type" modifiers.
      const names = rawNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          // drop leading "type " keyword (inline type modifier in named export)
          const noType = s.replace(/^type\s+/, '');
          // keep only the original name (before any "as ...")
          return (noType.split(/\s+as\s+/)[0] ?? '').trim();
        })
        .filter(Boolean) as string[];
      results.push({ source, names });
    }
  }

  return results;
}
