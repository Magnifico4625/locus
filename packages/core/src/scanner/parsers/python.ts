import type { ExportEntry, ImportEntry } from '../../types.js';

// Top-level class: `class Name:` or `class Name(Base):`
const CLASS_RE = /^class\s+([A-Za-z_]\w*)/;

// Top-level def: `def name(` or `def name():`
const DEF_RE = /^def\s+([A-Za-z_]\w*)/;

// from X import ... (captures module source)
const FROM_IMPORT_RE = /^from\s+(\S+)\s+import/;

// import X (captures module name, stops at comma/whitespace)
const PLAIN_IMPORT_RE = /^import\s+([A-Za-z_.]\S*)/;

export function parsePythonExports(code: string): ExportEntry[] {
  const results: ExportEntry[] = [];

  for (const line of code.split('\n')) {
    // Only match lines that start at column 0 (no leading whitespace)
    // This naturally captures only top-level definitions in Python

    const classMatch = CLASS_RE.exec(line);
    if (classMatch) {
      const name = classMatch[1] ?? '';
      if (name && !name.startsWith('_')) {
        results.push({ name, kind: 'class', isDefault: false, isTypeOnly: false });
      }
      continue;
    }

    const defMatch = DEF_RE.exec(line);
    if (defMatch) {
      const name = defMatch[1] ?? '';
      if (name && !name.startsWith('_')) {
        results.push({ name, kind: 'function', isDefault: false, isTypeOnly: false });
      }
    }
  }

  return results;
}

export function parsePythonImports(code: string): ImportEntry[] {
  const results: ImportEntry[] = [];

  for (const line of code.split('\n')) {
    const fromMatch = FROM_IMPORT_RE.exec(line);
    if (fromMatch) {
      const source = fromMatch[1] ?? '';
      if (source) {
        results.push({ source, isTypeOnly: false, isDynamic: false });
      }
      continue;
    }

    const plainMatch = PLAIN_IMPORT_RE.exec(line);
    if (plainMatch) {
      const source = plainMatch[1] ?? '';
      if (source) {
        results.push({ source, isTypeOnly: false, isDynamic: false });
      }
    }
  }

  return results;
}
