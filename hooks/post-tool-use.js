// Locus post-tool-use hook
// Captures metadata from tool invocations (metadata-only by default)
// See ARCHITECTURE.md Contract 1 for field specifications

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, resolve } from 'node:path';

// ─── Error classification ────────────────────────────────────────────────────

/**
 * Classifies an error message string into an ErrorKind enum value.
 * @param {string} msg
 * @returns {string}
 */
export function classifyError(msg) {
  if (/ENOENT|not found|no such file/i.test(msg)) return 'file_not_found';
  if (/EACCES|permission denied/i.test(msg)) return 'permission_denied';
  if (/timeout|timed out/i.test(msg)) return 'timeout';
  if (/syntax|parse|unexpected token/i.test(msg)) return 'syntax_error';
  if (/ECONNREFUSED|ENETUNREACH|DNS/i.test(msg)) return 'network_error';
  return 'unknown';
}

// ─── File path extraction ────────────────────────────────────────────────────

// Common file extensions to look for in Bash commands
const FILE_EXTENSIONS_RE =
  /(?:^|\s|['"`])([^\s'"`]+\.(?:ts|js|tsx|jsx|mjs|cjs|json|md|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|swift|kt|sh|bash|zsh|yml|yaml|toml|xml|html|css|scss|sql|txt|env|cfg|conf|ini))\b/g;

/**
 * Extracts file paths mentioned in a tool invocation.
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @returns {string[]}
 */
export function extractFilePaths(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const fp = toolInput.file_path;
      return typeof fp === 'string' && fp.length > 0 ? [fp] : [];
    }

    case 'Glob': {
      const pat = toolInput.pattern;
      return typeof pat === 'string' && pat.length > 0 ? [pat] : [];
    }

    case 'Grep': {
      const gPath = toolInput.path;
      return typeof gPath === 'string' && gPath.length > 0 ? [gPath] : [];
    }

    case 'Bash': {
      const cmd = toolInput.command;
      if (typeof cmd !== 'string' || cmd.length === 0) return [];
      const paths = [];
      FILE_EXTENSIONS_RE.lastIndex = 0;
      // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
      for (let match; (match = FILE_EXTENSIONS_RE.exec(cmd)) !== null; ) {
        const p = match[1];
        if (p && !paths.includes(p)) {
          paths.push(p);
        }
      }
      return paths;
    }

    default:
      return [];
  }
}

// ─── Diff stats extraction ───────────────────────────────────────────────────

/**
 * Parses git diff --stat style output for insertion/deletion counts.
 * Looks for patterns like "3 insertions(+), 1 deletion(-)" or "5 insertions(+)".
 * @param {string | undefined} toolOutput
 * @returns {{ added: number; removed: number } | undefined}
 */
export function extractDiffStats(toolOutput) {
  if (typeof toolOutput !== 'string' || toolOutput.length === 0) return undefined;

  const insertMatch = toolOutput.match(/(\d+)\s+insertion(?:s)?\(\+\)/);
  const deleteMatch = toolOutput.match(/(\d+)\s+deletion(?:s)?\(-\)/);

  if (!insertMatch && !deleteMatch) return undefined;

  return {
    added: insertMatch ? parseInt(insertMatch[1], 10) : 0,
    removed: deleteMatch ? parseInt(deleteMatch[1], 10) : 0,
  };
}

// ─── Capture extraction ──────────────────────────────────────────────────────

/**
 * Builds the capture object from a Claude Code PostToolUse event at the given level.
 *
 * @param {{ tool_name: string; tool_input: Record<string, unknown>; tool_response: string; duration_ms: number; error?: string }} event
 * @param {'metadata' | 'redacted' | 'full'} captureLevel
 * @returns {object}
 */
export function extractCapture(event, captureLevel) {
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  const toolInput = event.tool_input ?? {};
  const toolResponse = typeof event.tool_response === 'string' ? event.tool_response : '';
  const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : 0;
  const errorMsg = typeof event.error === 'string' ? event.error : undefined;

  const status = errorMsg !== undefined ? 'error' : 'success';
  const filePaths = extractFilePaths(toolName, toolInput);
  const diffStats = extractDiffStats(toolResponse);
  const timestamp = Date.now();

  // exit_code: only meaningful for Bash tool
  let exitCode = null;
  if (toolName === 'Bash') {
    const raw = toolInput.exit_code;
    if (typeof raw === 'number') {
      exitCode = raw;
    } else if (errorMsg !== undefined) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }
  }

  // ── metadata level (base) ───────────────────────────────────────────────────
  const capture = {
    tool_name: toolName,
    file_paths_json: JSON.stringify(filePaths),
    status,
    exit_code: exitCode,
    timestamp,
    duration_ms: durationMs,
    diff_added: diffStats ? diffStats.added : null,
    diff_removed: diffStats ? diffStats.removed : null,
    error_kind: null,
    bash_command: null,
  };

  if (captureLevel === 'metadata') {
    return capture;
  }

  // ── redacted level ──────────────────────────────────────────────────────────
  capture.error_kind = errorMsg !== undefined ? classifyError(errorMsg) : null;

  if (toolName === 'Bash') {
    const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
    // First token only (command name without args)
    capture.bash_command = cmd.trim().split(/\s+/)[0] ?? '';
  }

  if (captureLevel === 'redacted') {
    return capture;
  }

  // ── full level ──────────────────────────────────────────────────────────────
  if (toolName === 'Bash') {
    const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
    capture.bash_command = cmd;
  }

  return capture;
}

// ─── DB path resolution ──────────────────────────────────────────────────────

function computeProjectHash(projectRoot) {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function resolveProjectRoot(cwd) {
  try {
    // execFileSync with an array of args is safe from shell injection
    const result = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (result) return resolve(result).replace(/\\/g, '/');
  } catch {
    // fall through to cwd
  }
  return resolve(cwd).replace(/\\/g, '/');
}

function computeDbPath(projectRoot) {
  const hash = computeProjectHash(projectRoot);
  return join(homedir(), '.claude', 'memory', `locus-${hash}`, 'locus.db');
}

// ─── DB open helpers ─────────────────────────────────────────────────────────

async function openDb(dbPath) {
  // Ensure parent directory exists
  const lastSep = Math.max(dbPath.lastIndexOf('/'), dbPath.lastIndexOf('\\'));
  const dirPath = lastSep > 0 ? dbPath.substring(0, lastSep) : null;
  if (dirPath && !existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  // ── Try node:sqlite (Node 22+) ───────────────────────────────────────────
  try {
    const nodeSqlite = await import('node:sqlite');
    const raw = new nodeSqlite.DatabaseSync(dbPath);

    raw.exec(`CREATE TABLE IF NOT EXISTS hook_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT,
      file_paths_json TEXT,
      status TEXT,
      exit_code INTEGER,
      timestamp INTEGER,
      duration_ms INTEGER,
      diff_added INTEGER,
      diff_removed INTEGER,
      error_kind TEXT,
      bash_command TEXT
    )`);

    return {
      insert(capture) {
        const stmt = raw.prepare(
          `INSERT INTO hook_captures
            (tool_name, file_paths_json, status, exit_code, timestamp, duration_ms,
             diff_added, diff_removed, error_kind, bash_command)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        stmt.run(
          capture.tool_name,
          capture.file_paths_json,
          capture.status,
          capture.exit_code,
          capture.timestamp,
          capture.duration_ms,
          capture.diff_added,
          capture.diff_removed,
          capture.error_kind,
          capture.bash_command,
        );
      },
      close() {
        raw.close();
      },
    };
  } catch {
    // node:sqlite not available (Node < 22)
  }

  // ── Try sql.js fallback ──────────────────────────────────────────────────
  try {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    let sqlDb;
    if (existsSync(dbPath)) {
      const fileData = readFileSync(dbPath);
      sqlDb = new SQL.Database(new Uint8Array(fileData));
    } else {
      sqlDb = new SQL.Database();
    }

    sqlDb.exec(`CREATE TABLE IF NOT EXISTS hook_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT,
      file_paths_json TEXT,
      status TEXT,
      exit_code INTEGER,
      timestamp INTEGER,
      duration_ms INTEGER,
      diff_added INTEGER,
      diff_removed INTEGER,
      error_kind TEXT,
      bash_command TEXT
    )`);

    return {
      insert(capture) {
        sqlDb.run(
          `INSERT INTO hook_captures
            (tool_name, file_paths_json, status, exit_code, timestamp, duration_ms,
             diff_added, diff_removed, error_kind, bash_command)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            capture.tool_name,
            capture.file_paths_json,
            capture.status,
            capture.exit_code,
            capture.timestamp,
            capture.duration_ms,
            capture.diff_added,
            capture.diff_removed,
            capture.error_kind,
            capture.bash_command,
          ],
        );
      },
      close() {
        const data = sqlDb.export();
        writeFileSync(dbPath, Buffer.from(data));
        sqlDb.close();
      },
    };
  } catch {
    // sql.js not available either
  }

  return null;
}

// ─── Main hook ───────────────────────────────────────────────────────────────

export default async function postToolUse(event) {
  let db = null;
  try {
    const captureLevel = process.env.LOCUS_CAPTURE_LEVEL ?? 'metadata';
    if (captureLevel !== 'metadata' && captureLevel !== 'redacted' && captureLevel !== 'full') {
      return undefined;
    }

    const cwd = process.env.PWD ?? process.cwd();
    const projectRoot = resolveProjectRoot(cwd);
    const dbPath = computeDbPath(projectRoot);

    db = await openDb(dbPath);
    if (!db) return undefined;

    const capture = extractCapture(event, captureLevel);
    db.insert(capture);
  } catch {
    // NEVER crash — silently swallow all errors
  } finally {
    if (db !== null) {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
    }
  }

  return undefined;
}
