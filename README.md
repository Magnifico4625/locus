# Locus

> Persistent project-aware memory for Claude Code. Knows your project, remembers your decisions, costs almost nothing.

[![npm version](https://img.shields.io/npm/v/locus-memory)](https://www.npmjs.com/package/locus-memory)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-485%20passed-brightgreen)](https://github.com/Magnifico4625/locus)

## What is Locus?

Claude Code loses context between sessions. Every new conversation starts from scratch — no memory of your architecture decisions, no awareness of which files exist, no record of what changed last week.

Locus solves this with three persistent memory layers:

- **Structural** — an auto-parsed map of files, exports, and imports, built from regex analysis of your codebase. Zero tokens consumed, always up to date.
- **Semantic** — decisions you save explicitly ("why JWT not sessions?", "why Postgres not Mongo?") with optional tags. Automatically redacted before storage.
- **Episodic** — a compressed history of what happened in each session: tools used, files changed, context captured via a PostToolUse hook.

Locus complements `CLAUDE.md` rather than replacing it. Static truths — conventions, architecture constraints, non-negotiable rules — belong in `CLAUDE.md`. Dynamic knowledge — current project state, evolving decisions, recent history — lives in Locus.

Locus stores metadata only by default. No raw file content is ever written to disk unless you explicitly opt in.

## Features

- 3 memory layers: structural (auto-parsed), semantic (user-curated), episodic (auto-captured)
- 9 MCP tools for exploring, searching, remembering, and managing memory
- 3 auto-injected MCP resources (<3.5k tokens total)
- Incremental scanning: git-diff → mtime → full rescan strategies
- 4-layer security: metadata-only → file denylist → content redaction → audit UX
- FTS5 full-text search across all memory layers
- Zero native dependencies — Node 22+ built-in sqlite, sql.js fallback
- Cross-platform: Windows, macOS, Linux
- PostToolUse hook for automatic episodic capture

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

## Tools Reference

| Tool | Parameters | Description |
|------|-----------|-------------|
| `memory_explore` | `path: string` | Navigate project structure by directory |
| `memory_search` | `query: string` | Full-text search across all 3 memory layers |
| `memory_remember` | `text: string, tags?: string[]` | Store a decision with auto-redaction |
| `memory_forget` | `query: string, confirmToken?: string` | Delete matching memories (bulk-delete safety) |
| `memory_scan` | — | Scan project and index code structure |
| `memory_status` | — | Runtime stats, config, and DB info |
| `memory_doctor` | — | 10-point environment health check |
| `memory_audit` | — | Data inventory and security audit |
| `memory_purge` | `confirmToken?: string` | Clear all project memory (two-step confirmation) |

## Resources

Three resources are auto-injected at the start of every Claude Code session. They consume under 3.5k tokens combined.

| URI | Description | Token Budget |
|-----|-------------|-------------|
| `memory://project-map` | File tree with exports, imports, and confidence metrics | <2,000 tokens |
| `memory://decisions` | Recent semantic memories (up to 15 entries) | <500 tokens |
| `memory://recent` | Session activity log (up to 5 sessions) | <1,000 tokens |

## Configuration

**Environment Variables:**

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `LOCUS_LOG` | `error`, `info`, `debug` | `error` | Logging verbosity |
| `LOCUS_CAPTURE_LEVEL` | `metadata`, `redacted`, `full` | `metadata` | PostToolUse hook capture detail level (MCP server override planned) |

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

## Security

Locus uses a 4-layer security model:

1. **Metadata-only** — by default, only file paths, exports, and imports are stored. No raw file content is written to disk.
2. **File denylist** — `.env`, `*.key`, `credentials.*`, and other sensitive patterns are never indexed.
3. **Content redaction** — passwords, API keys, and tokens are automatically stripped from any content before storage.
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
|             9 MCP Tools                  |
+------------------------------------------+
|         Scanner (regex-based)            |
|    git-diff -> mtime -> full rescan      |
+------------------------------------------+
|     Storage: node:sqlite | sql.js        |
|     ~/.claude/memory/locus-{hash}/       |
+------------------------------------------+
|   PostToolUse Hook (metadata capture)    |
+------------------------------------------+
```

- **Structural memory**: regex-parsed exports and imports with confidence tagging
- **Semantic memory**: user-curated decisions, automatically redacted before storage
- **Episodic memory**: PostToolUse hook captures, lazy-compressed when the token count exceeds the threshold
- **Storage**: node:sqlite (Node 22+) primary, sql.js fallback (Node 20+)
- **FTS5**: full-text search across all layers, auto-detected at startup

## Development

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install

npm test            # 485 tests (vitest)
npm run typecheck   # TypeScript strict mode
npm run lint        # Biome linter
npm run build       # Bundle -> dist/server.js (~1.1 MB)
npm run check       # All of the above
```

## License

MIT — see [LICENSE](LICENSE)
