# Locus

> Persistent project-aware memory for Claude Code. Knows your project, remembers your decisions, costs almost nothing.

[![npm version](https://img.shields.io/npm/v/locus-memory)](https://www.npmjs.com/package/locus-memory)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-721%20passed-brightgreen)](https://github.com/Magnifico4625/locus)

## What is Locus?

Claude Code loses context between sessions. Every new conversation starts from scratch — no memory of your architecture decisions, no awareness of which files exist, no record of what changed last week.

Locus solves this with three persistent memory layers:

- **Structural** — an auto-parsed map of files, exports, and imports, built from regex analysis of your codebase. Zero tokens consumed, always up to date.
- **Semantic** — decisions you save explicitly ("why JWT not sessions?", "why Postgres not Mongo?") with optional tags. Automatically redacted before storage.
- **Episodic** — a compressed history of what happened in each session: tools used, files changed, context captured via hooks.

**New in v3.0 — Carbon Copy:** Zero-cost passive capture of prompts, AI responses, and file changes. Three Claude Code hooks (UserPromptSubmit, Stop, PostToolUse) write JSON events to a local inbox. A 4-phase ingest pipeline processes them into searchable conversation events — no tokens consumed on write, only on recall.

Locus complements `CLAUDE.md` rather than replacing it. Static truths — conventions, architecture constraints, non-negotiable rules — belong in `CLAUDE.md`. Dynamic knowledge — current project state, evolving decisions, recent history — lives in Locus.

Locus stores metadata only by default. No raw file content is ever written to disk unless you explicitly opt in.

## Features

- 3 memory layers: structural (auto-parsed), semantic (user-curated), episodic (auto-captured)
- **Carbon Copy**: passive conversation capture via inbox-based event protocol
- 12 MCP tools for exploring, searching, remembering, and managing memory
- 3 auto-injected MCP resources (<3.5k tokens total)
- Incremental scanning: git-diff → mtime → full rescan strategies
- 4-layer security: metadata-only → file denylist → content redaction → audit UX
- FTS5 full-text search across all memory layers + conversation events
- Zero native dependencies — Node 22+ built-in sqlite, sql.js fallback
- Cross-platform: Windows, macOS, Linux
- 3 Claude Code hooks: UserPromptSubmit, Stop (transcript parser), PostToolUse

## Quick Start

**Prerequisites:** Node.js >= 22, Claude Code

**As a Claude Code plugin:**

```bash
# From marketplace (when published)
claude plugin install locus

# From local directory (for development)
claude --plugin-dir /path/to/locus
```

**First use:**

Once installed, Locus auto-injects 3 resources into every conversation. The resources appear automatically — no configuration required.

Use `memory_scan` to index your project structure on first run, then `memory_search` to explore what was found. Use `memory_remember` to save decisions as you make them.

**Carbon Copy capture:**

By default, Locus captures tool use metadata (files read/written, tools used). To enable full conversation capture including prompts and AI responses:

```bash
export LOCUS_CAPTURE_LEVEL=full    # or 'redacted' for auto-redacted content
```

## Tools Reference

| Tool | Parameters | Description |
|------|-----------|-------------|
| `memory_explore` | `path: string` | Navigate project structure by directory |
| `memory_search` | `query: string, timeRange?, filePath?, kind?` | Full-text search across all memory layers + conversation events |
| `memory_remember` | `text: string, tags?: string[]` | Store a decision with auto-redaction |
| `memory_forget` | `query: string, confirmToken?: string` | Delete matching memories (bulk-delete safety) |
| `memory_scan` | — | Scan project and index code structure |
| `memory_status` | — | Runtime stats, config, inbox metrics, and DB info |
| `memory_doctor` | — | 10-point environment health check |
| `memory_audit` | — | Data inventory and security audit |
| `memory_config` | — | Show current configuration and sources |
| `memory_compact` | `maxAgeDays?, keepSessions?` | Clean up old episodic memory entries |
| `memory_purge` | `confirmToken?: string` | Clear all project memory (two-step confirmation) |
| `memory_timeline` | `timeRange?, kind?, filePath?, summary?` | Chronological event feed with optional summary mode |

### Extended Search Parameters (v3.0)

`memory_search` now supports additional filters for conversation events:

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeRange` | `{relative?: string}` or `{from?: number, to?: number}` | Filter by time. Relative values: `today`, `yesterday`, `this_week`, `last_7d`, `last_30d` |
| `filePath` | `string` | Filter events by file path (exact match via event_files join) |
| `kind` | `string` | Filter by event kind: `user_prompt`, `ai_response`, `tool_use`, `file_diff`, `session_start`, `session_end` |
| `source` | `string` | Filter by event source (e.g., `claude-code`) |
| `limit` | `number` | Max conversation results (default: 20) |
| `offset` | `number` | Pagination offset for conversation results |

## Resources

Three resources are auto-injected at the start of every Claude Code session. They consume under 3.5k tokens combined.

| URI | Description | Token Budget |
|-----|-------------|-------------|
| `memory://project-map` | File tree with exports, imports, and confidence metrics | <2,000 tokens |
| `memory://decisions` | Recent semantic memories (up to 15 entries) | <500 tokens |
| `memory://recent` | Session activity log + conversation stats | <1,000 tokens |

## Configuration

**Environment Variables:**

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `LOCUS_LOG` | `error`, `info`, `debug` | `error` | Logging verbosity |
| `LOCUS_CAPTURE_LEVEL` | `metadata`, `redacted`, `full` | `metadata` | Capture detail level (read by hooks and MCP server) |

**Capture Levels:**

| Level | Tool Use | File Diffs | User Prompts | AI Responses |
|-------|----------|------------|-------------|-------------|
| `metadata` | Captured | Captured | Filtered | Filtered |
| `redacted` | Captured | Captured | Captured (secrets redacted) | Captured (secrets redacted) |
| `full` | Captured | Captured | Captured (secrets redacted) | Captured (secrets redacted) |

> **Note:** Secrets are always redacted before storage regardless of capture level. The difference between `redacted` and `full` is reserved for future fine-grained control.

**Default Configuration:**

```
captureLevel:         metadata     # No raw file content stored
maxScanFiles:         10,000       # Skip projects with >10k files
maxFileSize:          1 MB         # Skip files larger than 1 MB
compressionThreshold: 10,000       # Compress episodic memory above 10k tokens
rescanThreshold:      30%          # Rescan if >30% files changed
fullRescanCooldown:   5 min        # Minimum interval between full rescans
minScanInterval:      10 sec       # Minimum interval between any scans
```

**Search Engine:** Locus uses SQLite FTS5 for full-text search when available. If your Node.js build doesn't include FTS5, search automatically falls back to LIKE queries (slower, less accurate). Run `memory_doctor` to check your search engine status.

## Security

Locus uses a 4-layer security model:

1. **Metadata-only** — by default, only file paths, exports, and imports are stored. No raw file content is written to disk.
2. **File denylist** — `.env`, `*.key`, `credentials.*`, and other sensitive patterns are never indexed.
3. **Content redaction** — passwords, API keys, and tokens are automatically stripped from any content before storage. Redaction is applied twice: once in hooks before writing to disk, and again in the ingest pipeline before database storage.
4. **Audit UX** — the `memory_audit` tool shows exactly what is stored for the current project and flags any security concerns.

## Architecture

```
+------------------------------------------+
|          Claude Code Session             |
+------------+------------+----------------+
| Resource   | Resource   | Resource       |
| project    | decisions  | recent         |
| -map       |            |                |
+------------+------------+----------------+
|            12 MCP Tools                  |
+------------------------------------------+
|         Scanner (regex-based)            |
|    git-diff -> mtime -> full rescan      |
+------------------------------------------+
|     Storage: node:sqlite | sql.js        |
|     ~/.claude/memory/locus-{hash}/       |
+------------------------------------------+
|   4-Phase Ingest Pipeline                |
|   Intake -> Filter -> Transform -> Store |
+------------------------------------------+
|   3 Hooks: UserPromptSubmit, Stop,       |
|            PostToolUse                    |
|   -> inbox/ (atomic JSON events)         |
+------------------------------------------+
```

- **Structural memory**: regex-parsed exports and imports with confidence tagging
- **Semantic memory**: user-curated decisions, automatically redacted before storage
- **Episodic memory**: hook captures, lazy-compressed when the token count exceeds the threshold
- **Conversation events**: passively captured via hooks and indexed for search
- **Storage**: node:sqlite (Node 22+) primary, sql.js fallback (Node 20+)
- **FTS5**: full-text search across all layers, auto-detected at startup
- **Monorepo**: `@locus/core` (memory engine + MCP server) + `@locus/claude-code` (hooks)

## Development

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install

npm test            # 721 tests (vitest)
npm run typecheck   # TypeScript strict mode
npm run lint        # Biome linter
npm run build       # Bundle -> dist/server.js (~1.1 MB)
npm run check       # All of the above
```

## License

MIT — see [LICENSE](LICENSE)
