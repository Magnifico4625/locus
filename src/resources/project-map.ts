import type { DatabaseAdapter } from '../types.js';
import { estimateTokens } from '../utils.js';

// ─── DB Row types ─────────────────────────────────────────────────────────────

interface FileRow {
  relative_path: string;
  file_type: string | null;
  language: string | null;
  confidence_level: string | null;
  skipped_reason: string | null;
}

interface ScanStateRow {
  key: string;
  value: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface DirInfo {
  name: string;
  files: string[];
  isTest: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.node.json',
  'biome.json',
  'eslint.config.js',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'vite.config.ts',
  'vite.config.js',
  'vitest.config.ts',
  'vitest.config.js',
  'webpack.config.js',
  'rollup.config.js',
  '.babelrc',
  'babel.config.js',
  'jest.config.js',
  'jest.config.ts',
  '.gitignore',
  '.gitattributes',
  '.env',
  '.env.example',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
]);

const TEST_DIR_PATTERNS = ['test', 'tests', '__tests__', 'spec', '__spec__', 'e2e'];

function isTestDir(name: string): boolean {
  const lower = name.toLowerCase();
  return TEST_DIR_PATTERNS.some((p) => lower === p || lower.startsWith(`${p}/`));
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function formatRelativeTime(epochSeconds: number): string {
  const nowMs = Date.now();
  const diffMs = nowMs - epochSeconds * 1000;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diffSec / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// ─── Tree builder ─────────────────────────────────────────────────────────────

/**
 * Groups scanned file paths into directory buckets (max 2 levels deep from root).
 * Root-level config files are excluded from listing.
 */
function buildDirMap(paths: string[]): Map<string, DirInfo> {
  const dirs = new Map<string, DirInfo>();

  for (const rawPath of paths) {
    // Normalise to forward slashes
    const p = rawPath.replace(/\\/g, '/');
    const parts = p.split('/');

    if (parts.length === 1) {
      // Root-level file: skip config files, group remainder under ''
      const filename = parts[0] ?? '';
      if (CONFIG_FILES.has(filename)) continue;
      if (!dirs.has('')) {
        dirs.set('', { name: '', files: [], isTest: false });
      }
      (dirs.get('') as DirInfo).files.push(filename);
      continue;
    }

    // Use first path segment as the top-level dir key
    const topDir = parts[0] ?? '';
    const filename = parts[parts.length - 1] ?? '';

    if (!dirs.has(topDir)) {
      dirs.set(topDir, { name: topDir, files: [], isTest: isTestDir(topDir) });
    }
    (dirs.get(topDir) as DirInfo).files.push(filename);
  }

  return dirs;
}

function formatDirLine(info: DirInfo, countOnly: boolean): string {
  const label = info.name === '' ? '(root)' : `${info.name}/`;
  const count = info.files.length;

  if (info.isTest) {
    return `  ${label.padEnd(16)}${count} files`;
  }

  if (countOnly || count > 8) {
    return `  ${label.padEnd(16)}${count} files`;
  }

  // List file names without extensions, up to 8
  const names = info.files.slice(0, 8).map(stripExtension).join(', ');
  return `  ${label.padEnd(16)}${count} files: ${names}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateProjectMap(db: DatabaseAdapter, projectName: string): string {
  // ── Read files table ───────────────────────────────────────────────────────
  const allRows = db.all<FileRow>(
    'SELECT relative_path, file_type, language, confidence_level, skipped_reason FROM files',
  );

  if (allRows.length === 0) {
    return 'No files scanned yet.';
  }

  const scannedRows = allRows.filter((r) => r.skipped_reason === null || r.skipped_reason === '');
  const skippedRows = allRows.filter((r) => r.skipped_reason !== null && r.skipped_reason !== '');

  const totalScanned = scannedRows.length;
  const totalSkipped = skippedRows.length;

  // Confidence percentages (of scanned files only)
  const highCount = scannedRows.filter((r) => r.confidence_level === 'high').length;
  const mediumCount = scannedRows.filter((r) => r.confidence_level === 'medium').length;
  const highPct = totalScanned > 0 ? Math.round((highCount / totalScanned) * 100) : 0;
  const medPct = totalScanned > 0 ? Math.round((mediumCount / totalScanned) * 100) : 0;

  // Stack detection
  const langs = new Set<string>();
  for (const r of scannedRows) {
    if (r.language) langs.add(r.language);
  }
  const stackItems: string[] = [];
  if (langs.has('typescript')) stackItems.push('TypeScript');
  if (langs.has('javascript')) stackItems.push('JavaScript');
  if (langs.has('python')) stackItems.push('Python');
  // Any other languages
  for (const lang of langs) {
    if (lang !== 'typescript' && lang !== 'javascript' && lang !== 'python') {
      stackItems.push(lang.charAt(0).toUpperCase() + lang.slice(1));
    }
  }
  const stackStr = stackItems.length > 0 ? stackItems.join(', ') : 'unknown';

  // ── Read scan_state table ──────────────────────────────────────────────────
  const scanStateRows = db.all<ScanStateRow>('SELECT key, value FROM scan_state');
  const scanState = new Map<string, string>();
  for (const row of scanStateRows) {
    scanState.set(row.key, row.value);
  }

  const lastScanRaw = scanState.get('lastScan');
  const lastScanDuration = scanState.get('lastScanDuration') ?? '?';
  const lastScanStrategy = scanState.get('lastScanStrategy') ?? 'unknown';

  let lastScanStr = 'never';
  if (lastScanRaw) {
    const epochSec = Number(lastScanRaw);
    if (!Number.isNaN(epochSec) && epochSec > 0) {
      lastScanStr = formatRelativeTime(epochSec);
    }
  }

  // ── Build header ───────────────────────────────────────────────────────────
  const header = [
    `Project: ${projectName} (${stackStr})`,
    `Files: ${totalScanned} scanned, ${totalSkipped} skipped | Confidence: ${highPct}% high, ${medPct}% medium`,
    `Last scan: ${lastScanStr} (${lastScanStrategy}, ${lastScanDuration}ms)`,
  ].join('\n');

  // ── Build tree ─────────────────────────────────────────────────────────────
  const scannedPaths = scannedRows.map((r) => r.relative_path);
  const dirMap = buildDirMap(scannedPaths);

  // Sort dirs by file count descending (root '' goes first if present)
  const sortedDirs = Array.from(dirMap.values()).sort((a, b) => {
    if (a.name === '') return -1;
    if (b.name === '') return 1;
    return b.files.length - a.files.length;
  });

  // Max 20 dirs shown; if more, show top 15 + "N more dirs"
  const MAX_DIRS = 20;
  const SHOW_DIRS = 15;
  const hiddenDirCount = sortedDirs.length > MAX_DIRS ? sortedDirs.length - SHOW_DIRS : 0;
  const dirsToShow = hiddenDirCount > 0 ? sortedDirs.slice(0, SHOW_DIRS) : sortedDirs;

  // First attempt: normal formatting
  const treeLines = dirsToShow.map((info) => formatDirLine(info, false));
  if (hiddenDirCount > 0) {
    treeLines.push(`  + ${hiddenDirCount} more dirs`);
  }

  let tree = treeLines.join('\n');
  let output = `${header}\n\n${tree}`;

  // ── Progressive budget reduction ───────────────────────────────────────────
  const TOKEN_BUDGET = 2000;

  if (estimateTokens(output) > TOKEN_BUDGET) {
    // Switch to count-only for all dirs
    const countOnlyLines = dirsToShow.map((info) => formatDirLine(info, true));
    if (hiddenDirCount > 0) {
      countOnlyLines.push(`  + ${hiddenDirCount} more dirs`);
    }
    tree = countOnlyLines.join('\n');
    output = `${header}\n\n${tree}`;
  }

  if (estimateTokens(output) > TOKEN_BUDGET) {
    // Further reduce: show fewer dirs
    let maxDirs = dirsToShow.length;
    while (estimateTokens(output) > TOKEN_BUDGET && maxDirs > 1) {
      maxDirs -= 1;
      const reduced = dirsToShow.slice(0, maxDirs).map((info) => formatDirLine(info, true));
      const hiddenExtra = sortedDirs.length - maxDirs;
      if (hiddenExtra > 0) {
        reduced.push(`  + ${hiddenExtra} more dirs`);
      }
      tree = reduced.join('\n');
      output = `${header}\n\n${tree}`;
    }
  }

  return output;
}
