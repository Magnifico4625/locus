import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { isDenylisted } from '../security/file-ignore.js';
import type {
  DatabaseAdapter,
  FileEntry,
  ImportEntry,
  LocusConfig,
  ScanResult,
  ScanStats,
  ScanStrategy,
} from '../types.js';
import { loadPathAliases, type PathAliasMap, resolveAlias } from './aliases.js';
import { computeConfidence } from './confidence.js';
import { shouldIgnore } from './ignore.js';
import { parseTsConfig } from './parsers/config.js';
import { parsePythonExports, parsePythonImports } from './parsers/python.js';
import { parseExports, parseImports, parseReExports } from './parsers/typescript.js';
import { stripNonCode } from './strip.js';

// ─── Scan Context ────────────────────────────────────────────

export interface ScanContext {
  lastScan: number;
  lastHead: string | null;
  lastFullRescan: number;
  totalFiles: number;
}

// ─── Dependency Injection for testability ────────────────────

export interface ScanDeps {
  isGitRepo(path: string): boolean;
  getHead(path: string): string | null;
  diffUnstaged(path: string): string[];
  diffBetween(from: string, to: string, path: string): string[];
  isAncestor(older: string, newer: string, path: string): boolean;
  findByMtime(path: string, since: number): string[];
  now(): number;
}

// ─── Real implementations ────────────────────────────────────

const GIT_TIMEOUT = 5000;

function gitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export const defaultScanDeps: ScanDeps = {
  isGitRepo(path: string): boolean {
    return existsSync(join(path, '.git'));
  },

  getHead(path: string): string | null {
    try {
      return gitExec(['rev-parse', 'HEAD'], path) || null;
    } catch {
      return null;
    }
  },

  diffUnstaged(path: string): string[] {
    const out = gitExec(['diff', '--name-only'], path);
    return out ? out.split('\n').filter(Boolean) : [];
  },

  diffBetween(from: string, to: string, path: string): string[] {
    const out = gitExec(['diff', '--name-only', `${from}..${to}`], path);
    return out ? out.split('\n').filter(Boolean) : [];
  },

  isAncestor(older: string, newer: string, path: string): boolean {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', older, newer], {
        cwd: path,
        timeout: GIT_TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  },

  findByMtime(path: string, since: number): string[] {
    const results: string[] = [];
    const sinceMs = since * 1000;

    function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            // Skip well-known ignored dirs for performance
            if (entry === 'node_modules' || entry === '.git' || entry === 'dist') {
              continue;
            }
            walk(fullPath);
          } else if (stat.mtimeMs > sinceMs) {
            results.push(relative(path, fullPath).replace(/\\/g, '/'));
          }
        } catch {
          // permission errors, broken symlinks — skip
        }
      }
    }

    walk(path);
    return results;
  },

  now(): number {
    return Math.floor(Date.now() / 1000);
  },
};

// ─── Strategy helpers ────────────────────────────────────────

function shouldFullRescan(
  changed: number,
  total: number,
  canRescan: boolean,
  config: LocusConfig,
): boolean {
  if (!canRescan) return false;
  if (changed > config.rescanAbsoluteMax) return true;
  if (total > 0 && changed / total > config.rescanThreshold) return true;
  // Handle first scan: totalFiles=0 but files found → full
  if (total === 0 && changed > 0) return true;
  return false;
}

// ─── chooseScanStrategy ──────────────────────────────────────

export function chooseScanStrategy(
  projectPath: string,
  context: ScanContext,
  config: LocusConfig,
  deps: ScanDeps = defaultScanDeps,
): ScanStrategy {
  const now = deps.now();

  // Debounce: skip if last scan was too recent
  if (context.lastScan > 0 && now - context.lastScan < config.minScanInterval) {
    return { type: 'skip', filesToScan: [], reason: 'debounce' };
  }

  // Cooldown: can we do a full rescan?
  const canFullRescan =
    context.lastFullRescan === 0 || now - context.lastFullRescan > config.fullRescanCooldown;

  // ── Git path ──────────────────────────────────────────────
  if (deps.isGitRepo(projectPath)) {
    try {
      const currentHead = deps.getHead(projectPath);

      if (currentHead !== null && currentHead === context.lastHead) {
        // Same HEAD — check unstaged changes only
        const changed = deps.diffUnstaged(projectPath);
        if (changed.length === 0) {
          return { type: 'skip', filesToScan: [], reason: 'no changes' };
        }
        return { type: 'git-diff', filesToScan: changed, reason: 'unstaged changes' };
      }

      if (
        currentHead !== null &&
        context.lastHead !== null &&
        deps.isAncestor(context.lastHead, currentHead, projectPath)
      ) {
        // Fast-forward — diff between old and new HEAD
        const changed = deps.diffBetween(context.lastHead, currentHead, projectPath);
        if (shouldFullRescan(changed.length, context.totalFiles, canFullRescan, config)) {
          return {
            type: 'full',
            filesToScan: [],
            reason: `git: ${changed.length} files changed`,
          };
        }
        return {
          type: 'git-diff',
          filesToScan: changed,
          reason: `fast-forward: ${changed.length} files`,
        };
      }

      // HEAD changed but not ancestor (rebase, checkout) → fall through to mtime
    } catch {
      // Git command failed — fall through to mtime
    }
  }

  // ── mtime path ────────────────────────────────────────────
  const changed = deps.findByMtime(projectPath, context.lastScan);
  if (shouldFullRescan(changed.length, context.totalFiles, canFullRescan, config)) {
    return {
      type: 'full',
      filesToScan: [],
      reason: `mtime: ${changed.length} files changed`,
    };
  }
  return {
    type: 'mtime',
    filesToScan: changed,
    reason: `mtime: ${changed.length} files`,
  };
}

// ─── Language detection ──────────────────────────────────────

type Language = FileEntry['language'];

const LANG_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath).toLowerCase();
  return LANG_MAP[ext] ?? null;
}

// ─── Generated header detection ─────────────────────────────

const GENERATED_MARKERS = [
  '// auto-generated',
  '// @generated',
  '/* @generated',
  '// eslint-disable',
  '// this file is auto-generated',
  '# auto-generated',
  '# @generated',
];

function hasGeneratedHeader(content: string): boolean {
  const firstLines = content.split('\n', 5);
  for (const line of firstLines) {
    const lower = line.toLowerCase().trim();
    for (const marker of GENERATED_MARKERS) {
      if (lower.startsWith(marker)) return true;
    }
  }
  return false;
}

// ─── Binary detection ────────────────────────────────────────

function isBinary(content: string): boolean {
  // Check first 8KB for null bytes
  const sample = content.slice(0, 8192);
  return sample.includes('\0');
}

// ─── File type detection ─────────────────────────────────────

function detectFileType(
  relativePath: string,
  exports: { length: number },
  reExports: { length: number },
): FileEntry['fileType'] {
  // Barrel: only re-exports, no own exports
  if (reExports.length > 0 && exports.length === 0) return 'barrel';

  // Test file
  const lower = relativePath.toLowerCase();
  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__') ||
    lower.includes('/test/') ||
    lower.includes('/tests/')
  ) {
    return 'test';
  }

  return 'module';
}

// ─── scan_state helpers ──────────────────────────────────────

function getScanState(db: DatabaseAdapter, key: string): string | undefined {
  const row = db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [key]);
  return row?.value;
}

function setScanState(db: DatabaseAdapter, key: string, value: string): void {
  db.run('INSERT OR REPLACE INTO scan_state (key, value) VALUES (?, ?)', [key, value]);
}

// ─── Walk directory ──────────────────────────────────────────

function walkDirectory(dir: string, basePath: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else {
          results.push(relative(basePath, fullPath).replace(/\\/g, '/'));
        }
      } catch {
        // skip
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Load tsconfig aliases ───────────────────────────────────

function loadProjectAliases(projectPath: string): PathAliasMap {
  const tsconfigPath = join(projectPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return {};
  try {
    const content = readFileSync(tsconfigPath, 'utf-8');
    const rawPaths = parseTsConfig(content);
    return loadPathAliases(rawPaths);
  } catch {
    return {};
  }
}

// ─── Store FileEntry to DB ───────────────────────────────────

function storeFileEntry(db: DatabaseAdapter, entry: FileEntry): void {
  db.run(
    `INSERT OR REPLACE INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines,
      confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.relativePath,
      JSON.stringify(entry.exports),
      JSON.stringify(entry.imports),
      JSON.stringify(entry.reExports),
      entry.fileType,
      entry.language,
      entry.lines,
      entry.confidence.level,
      entry.confidence.reason ?? null,
      entry.lastScanned,
      entry.skippedReason ?? null,
    ],
  );
}

// ─── Store skipped file entry to DB ──────────────────────────

function storeSkippedEntry(
  db: DatabaseAdapter,
  relPath: string,
  reason: string,
  now: number,
): void {
  db.run(
    `INSERT OR REPLACE INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines,
      confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, '[]', '[]', '[]', NULL, NULL, 0, NULL, NULL, ?, ?)`,
    [relPath, now, reason],
  );
}

// ─── scanProject ─────────────────────────────────────────────

export async function scanProject(
  projectPath: string,
  db: DatabaseAdapter,
  config: LocusConfig,
  deps: ScanDeps = defaultScanDeps,
): Promise<ScanResult> {
  const startTime = Date.now();

  // Read scan state from DB
  const lastScanStr = getScanState(db, 'lastScan');
  const lastHead = getScanState(db, 'lastHead') ?? null;
  const lastFullRescanStr = getScanState(db, 'lastFullRescan');

  const row = db.get<{ count: number }>('SELECT COUNT(*) as count FROM files');
  const totalFiles = row?.count ?? 0;

  const context: ScanContext = {
    lastScan: lastScanStr ? Number(lastScanStr) : 0,
    lastHead,
    lastFullRescan: lastFullRescanStr ? Number(lastFullRescanStr) : 0,
    totalFiles,
  };

  // Decide strategy
  const strategy = chooseScanStrategy(projectPath, context, config, deps);

  if (strategy.type === 'skip') {
    return {
      files: [],
      stats: {
        totalFiles: 0,
        scannedFiles: 0,
        skippedFiles: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        durationMs: Date.now() - startTime,
      },
      strategy,
    };
  }

  // Determine files to process
  let filePaths: string[];
  if (strategy.type === 'full') {
    filePaths = walkDirectory(projectPath, projectPath);
  } else {
    filePaths = strategy.filesToScan;
  }

  // Load tsconfig aliases
  const aliases = loadProjectAliases(projectPath);

  const scannedEntries: FileEntry[] = [];
  let skippedFiles = 0;
  let highConfidence = 0;
  let mediumConfidence = 0;
  const now = deps.now();

  for (const relPath of filePaths) {
    // maxScanFiles limit
    if (scannedEntries.length >= config.maxScanFiles) {
      storeSkippedEntry(db, relPath, 'max-files-reached', now);
      skippedFiles++;
      continue;
    }

    // Ignore check
    if (shouldIgnore(relPath)) {
      storeSkippedEntry(db, relPath, 'ignored', now);
      skippedFiles++;
      continue;
    }

    // Security denylist check
    if (isDenylisted(relPath)) {
      storeSkippedEntry(db, relPath, 'denylisted', now);
      skippedFiles++;
      continue;
    }

    // Language detection
    const language = detectLanguage(relPath);
    if (language === null) {
      storeSkippedEntry(db, relPath, 'unknown-language', now);
      skippedFiles++;
      continue;
    }

    // File size check
    const fullPath = join(projectPath, relPath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      storeSkippedEntry(db, relPath, 'stat-failed', now);
      skippedFiles++;
      continue;
    }

    if (stat.size > config.maxFileSize) {
      storeSkippedEntry(db, relPath, 'too-large', now);
      skippedFiles++;
      continue;
    }

    // Read file
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      storeSkippedEntry(db, relPath, 'read-failed', now);
      skippedFiles++;
      continue;
    }

    // Binary check
    if (isBinary(content)) {
      storeSkippedEntry(db, relPath, 'binary', now);
      skippedFiles++;
      continue;
    }

    const lines = content.split('\n').length;
    const isGenerated = hasGeneratedHeader(content);

    // Parse based on language
    let exports: FileEntry['exports'] = [];
    let imports: ImportEntry[] = [];
    let reExports: FileEntry['reExports'] = [];
    let hasDynamicImport = false;

    if (language === 'typescript' || language === 'javascript') {
      const stripped = stripNonCode(content);
      // Use stripped code for exports (removes commented-out exports)
      exports = parseExports(stripped);
      // Use original code for imports/reExports (need string content for source paths)
      imports = parseImports(content);
      reExports = parseReExports(content);

      // Check for dynamic imports
      hasDynamicImport = imports.some((imp) => imp.isDynamic);

      // Resolve aliases
      let hasUnresolvedAlias = false;
      for (const imp of imports) {
        const resolved = resolveAlias(imp.source, aliases);
        if (resolved !== undefined) {
          imp.resolvedPath = resolved;
        } else if (
          imp.source.startsWith('@') ||
          imp.source.startsWith('~') ||
          imp.source.startsWith('#')
        ) {
          hasUnresolvedAlias = true;
        }
      }

      // Compute confidence with alias info
      const confidence = computeConfidence({
        exports,
        imports,
        reExports,
        lines,
        hasGeneratedHeader: isGenerated,
        hasDynamicImport,
        hasUnresolvedAlias,
      });

      const fileType = detectFileType(relPath, exports, reExports);
      const entry: FileEntry = {
        relativePath: relPath,
        exports,
        imports,
        reExports,
        fileType,
        language,
        lines,
        confidence,
        lastScanned: now,
      };

      storeFileEntry(db, entry);
      scannedEntries.push(entry);

      if (confidence.level === 'high') highConfidence++;
      else mediumConfidence++;
    } else if (language === 'python') {
      exports = parsePythonExports(content);
      imports = parsePythonImports(content);

      const confidence = computeConfidence({
        exports,
        imports,
        reExports: [],
        lines,
        hasGeneratedHeader: isGenerated,
        hasDynamicImport: false,
        hasUnresolvedAlias: false,
      });

      const fileType = detectFileType(relPath, exports, []);
      const entry: FileEntry = {
        relativePath: relPath,
        exports,
        imports,
        reExports: [],
        fileType,
        language,
        lines,
        confidence,
        lastScanned: now,
      };

      storeFileEntry(db, entry);
      scannedEntries.push(entry);

      if (confidence.level === 'high') highConfidence++;
      else mediumConfidence++;
    }
  }

  // Update scan_state
  setScanState(db, 'lastScan', String(now));
  if (strategy.type === 'full') {
    setScanState(db, 'lastFullRescan', String(now));
  }

  // Update git HEAD if available
  if (deps.isGitRepo(projectPath)) {
    const head = deps.getHead(projectPath);
    if (head) {
      setScanState(db, 'lastHead', head);
    }
  }

  const durationMs = Date.now() - startTime;

  // Write strategy and duration to scan_state
  setScanState(db, 'lastStrategy', strategy.type);
  setScanState(db, 'lastScanDuration', String(durationMs));

  const stats: ScanStats = {
    totalFiles: filePaths.length,
    scannedFiles: scannedEntries.length,
    skippedFiles,
    highConfidence,
    mediumConfidence,
    durationMs,
  };

  return { files: scannedEntries, stats, strategy };
}
