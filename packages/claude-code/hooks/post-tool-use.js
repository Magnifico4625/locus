// Locus post-tool-use hook (v3 — inbox writer)
// Writes tool invocation events as JSON files to the inbox directory.
// The MCP server's ingest pipeline processes these into conversation_events.
// See ARCHITECTURE.md Contract 1 for field specifications.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
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

// ─── Project root + inbox path ───────────────────────────────────────────────

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

/**
 * Computes the inbox directory path for a given project root.
 * Inbox is co-located with the DB: ~/.claude/memory/locus-<hash>/inbox/
 * @param {string} projectRoot
 * @returns {string}
 */
export function computeInboxDir(projectRoot) {
  const hash = computeProjectHash(projectRoot);
  return join(homedir(), '.claude', 'memory', `locus-${hash}`, 'inbox');
}

// ─── Main hook ───────────────────────────────────────────────────────────────

/**
 * PostToolUse hook — writes an InboxEvent JSON file to the project inbox.
 * The MCP server's ingest pipeline picks up and processes these files.
 *
 * Contract: NEVER crash. All errors are silently swallowed.
 */
export default async function postToolUse(event) {
  try {
    const captureLevel = process.env.LOCUS_CAPTURE_LEVEL ?? 'metadata';
    if (captureLevel !== 'metadata' && captureLevel !== 'redacted' && captureLevel !== 'full') {
      return undefined;
    }

    const cwd = process.env.PWD ?? process.cwd();
    const projectRoot = resolveProjectRoot(cwd);
    const inboxDir = computeInboxDir(projectRoot);

    // Build capture data from the tool event
    const capture = extractCapture(event, captureLevel);
    const filePaths = JSON.parse(capture.file_paths_json);

    // Build InboxEvent payload (ToolUsePayload shape)
    const payload = {
      tool: capture.tool_name,
      files: filePaths,
      status: capture.status,
    };
    if (capture.exit_code !== null) {
      payload.exitCode = capture.exit_code;
    }
    if (capture.diff_added !== null) {
      payload.diffStats = { added: capture.diff_added, removed: capture.diff_removed };
    }
    if (capture.duration_ms > 0) {
      payload.durationMs = capture.duration_ms;
    }
    if (capture.error_kind !== null) {
      payload.errorKind = capture.error_kind;
    }
    if (capture.bash_command !== null) {
      payload.bashCommand = capture.bash_command;
    }

    // Build the InboxEvent
    const eventId = randomUUID();
    const inboxEvent = {
      version: 1,
      event_id: eventId,
      source: 'claude-code',
      project_root: projectRoot,
      timestamp: capture.timestamp,
      kind: 'tool_use',
      payload,
    };

    // Add session_id if available
    if (typeof event.session_id === 'string' && event.session_id.length > 0) {
      inboxEvent.session_id = event.session_id;
    }

    // Atomic write: .tmp → rename
    mkdirSync(inboxDir, { recursive: true });
    const shortId = eventId.slice(0, 8);
    const filename = `${capture.timestamp}-${shortId}.json`;
    const finalPath = join(inboxDir, filename);
    const tmpPath = `${finalPath}.tmp`;

    writeFileSync(tmpPath, JSON.stringify(inboxEvent), 'utf-8');
    renameSync(tmpPath, finalPath);
  } catch {
    // NEVER crash — silently swallow all errors
  }

  return undefined;
}
