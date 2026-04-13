# Locus

> Persistent project-aware memory for AI coding tools. Built on [MCP](https://modelcontextprotocol.io). Works with Claude Code, Codex CLI, Cursor, Windsurf, and any MCP-compatible client.

[![npm version](https://img.shields.io/npm/v/locus-memory)](https://www.npmjs.com/package/locus-memory)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-863%20passed-brightgreen)](https://github.com/Magnifico4625/locus)
[![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io)

## What is Locus?

AI coding tools lose context between sessions. Every new conversation starts from scratch — no memory of your architecture decisions, no awareness of which files exist, no record of what changed last week.

Locus solves this with three persistent memory layers:

- **Structural** — an auto-parsed map of files, exports, and imports, built from regex analysis of your codebase. Zero tokens consumed, always up to date.
- **Semantic** — decisions you save explicitly ("why JWT not sessions?", "why Postgres not Mongo?") with optional tags. Automatically redacted before storage.
- **Episodic** — a compressed history of what happened in each session: tools used, files changed, context captured via hooks.

**New in v3.0 — Carbon Copy:** Zero-cost passive capture of prompts, AI responses, and file changes via an inbox-based event protocol. A 4-phase ingest pipeline processes events into searchable conversation history — no tokens consumed on write, only on recall.

**New in v3.1 — Multi-Client Architecture:** Client-aware storage with automatic detection of Claude Code and Codex CLI environments. One MCP server, every client, your data stays on your machine.

Locus stores metadata only by default. No raw file content is ever written to disk unless you explicitly opt in.

## Compatibility

Locus is an MCP server. It works with any tool that supports the [Model Context Protocol](https://modelcontextprotocol.io).

| Feature | Claude Code | Codex CLI | Cursor / Windsurf / Cline / Zed |
|---------|-------------|-----------|----------------------------------|
| 13 MCP tools (search, explore, remember...) | Full support | Full support | Full support |
| 3 MCP resources (project-map, decisions, recent) | Auto-injected | On demand | Manual config |
| Carbon Copy capture | Full support via hooks (v3.0) | Auto-import before `memory_search` + manual `memory_import_codex` | Planned for v3.2 via adapters |

**How it works:** The MCP server provides 13 tools and 3 resources to any connected client. Storage location is auto-detected per client (`~/.claude/memory/` for Claude Code, `$CODEX_HOME/memory/` for Codex CLI, `~/.locus/memory/` for others). In Claude Code, three native hooks additionally capture conversation events into a local inbox for passive memory. In Codex CLI, the newest rollout session is auto-imported before `memory_search` in a bounded, debounced, best-effort way, and `memory_import_codex` remains available for explicit catch-up or filtered manual import.

## Features

- 3 memory layers: structural (auto-parsed), semantic (user-curated), episodic (auto-captured)
- **Carbon Copy**: passive conversation capture via inbox-based event protocol
- 13 MCP tools for exploring, searching, remembering, and managing memory
- 3 auto-injected MCP resources (<3.5k tokens total)
- Incremental scanning: git-diff → mtime → full rescan strategies
- 4-layer security: metadata-only → file denylist → content redaction → audit UX
- FTS5 full-text search across all memory layers + conversation events
- Zero native dependencies — Node 22+ built-in sqlite, sql.js fallback
- Cross-platform: Windows, macOS, Linux

## Quick Start

**Prerequisites:** Node.js >= 22.0.0

### Claude Code (plugin — recommended)

```bash
# Install as a plugin
claude plugin install locus

# Or from local directory (for development)
claude --plugin-dir /path/to/locus
```

Once installed, Locus auto-injects 3 resources into every conversation — no configuration required. Three hooks automatically capture conversation events into a local inbox.

### Codex CLI

Add Locus as an MCP server:

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or add directly to `~/.codex/config.toml`:

```toml
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
```

> **Note:** Codex CLI storage goes to `$CODEX_HOME/memory/`. All 13 MCP tools and 3 resources work immediately. Before `memory_search`, Locus auto-imports the newest Codex rollout session with a local debounce window. `memory_import_codex` remains available when you want explicit control, filtered import, or manual catch-up across older sessions.

Recent Codex history becomes searchable automatically when you use `memory_search`.

Import the latest Codex rollout session on demand:

```text
memory_import_codex({"latestOnly":true})
```

Import only sessions for one project or session id:

```text
memory_import_codex({"projectRoot":"C:\\Users\\Admin\\my-project"})
memory_import_codex({"sessionId":"sess_abc123"})
memory_import_codex({"since":1710000000000})
```

### Any MCP Client (Cursor, Windsurf, Cline, Zed, etc.)

Add Locus to your MCP configuration. The exact file depends on your tool:

| Tool | Config file |
|------|------------|
| Cursor | `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | VS Code MCP settings |
| Claude Desktop | `claude_desktop_config.json` |

Add this server entry:

```json
{
  "mcpServers": {
    "locus": {
      "command": "node",
      "args": ["/path/to/locus/dist/server.js"],
      "env": {
        "LOCUS_LOG": "error"
      }
    }
  }
}
```

> **Note:** When using Locus outside Claude Code, the MCP tools and resources work fully. Codex CLI additionally supports auto-import before `memory_search` plus manual session import via `memory_import_codex`. Adapter support for IDE log files in Cursor, Windsurf, and similar clients is planned for v3.2.

### First Use

Use `memory_scan` to index your project structure on first run, then `memory_search` to explore what was found. Use `memory_remember` to save decisions as you make them.

### Carbon Copy Capture (Claude Code)

By default, Locus captures tool use metadata (files read/written, tools used). To enable richer capture:

```bash
export LOCUS_CAPTURE_LEVEL=full      # prompts + AI responses (secrets redacted)
# or
export LOCUS_CAPTURE_LEVEL=redacted  # prompts as keywords only, no AI responses
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
| `memory_doctor` | — | 12-point environment health check |
| `memory_audit` | — | Data inventory and security audit |
| `memory_config` | — | Show current configuration and sources |
| `memory_compact` | `maxAgeDays?, keepSessions?` | Clean up old episodic memory entries |
| `memory_purge` | `confirmToken?: string` | Clear all project memory (two-step confirmation) |
| `memory_timeline` | `timeRange?, kind?, filePath?, summary?` | Chronological event feed with optional summary mode |
| `memory_import_codex` | `latestOnly?, projectRoot?, sessionId?, since?` | Manually import Codex rollout JSONL sessions into inbox and storage |

### Extended Search Parameters (v3.0)

`memory_search` supports filters for conversation events:

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeRange` | `{relative?: string}` or `{from?: number, to?: number}` | Filter by time. Relative: `today`, `yesterday`, `this_week`, `last_7d`, `last_30d` |
| `filePath` | `string` | Filter events by file path (exact match via event_files join) |
| `kind` | `string` | Event kind: `user_prompt`, `ai_response`, `tool_use`, `file_diff`, `session_start`, `session_end` |
| `source` | `string` | Filter by event source (e.g., `claude-code`) |
| `limit` | `number` | Max conversation results (default: 20) |
| `offset` | `number` | Pagination offset for conversation results |

## Resources

Three MCP resources provide lightweight context at the start of every session (<3.5k tokens combined).

| URI | Description | Token Budget |
|-----|-------------|-------------|
| `memory://project-map` | File tree with exports, imports, and confidence metrics | <2,000 tokens |
| `memory://decisions` | Recent semantic memories (up to 15 entries) | <500 tokens |
| `memory://recent` | Session activity log + conversation stats | <1,000 tokens |

> In Claude Code, resources are auto-injected. In other MCP clients, configure your tool to read these resources at session start.

## Configuration

**Environment Variables:**

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `LOCUS_LOG` | `error`, `info`, `debug` | `error` | Logging verbosity |
| `LOCUS_CAPTURE_LEVEL` | `metadata`, `redacted`, `full` | `metadata` | Capture detail level (hooks + MCP server) |
| `LOCUS_CODEX_CAPTURE` | `off`, `metadata`, `redacted`, `full` | `metadata` | Codex JSONL import behavior for both auto-import before `memory_search` and `memory_import_codex` |

**Capture Levels:**

| Level | Tool Use | User Prompts | AI Responses | File Diffs |
|-------|----------|-------------|-------------|------------|
| `metadata` (default) | stats only | Filtered | Filtered | stats only |
| `redacted` | + error kind, command name | keywords only (RAKE) | Filtered | stats only |
| `full` | + full command (redacted) | full text (redacted) | full text (redacted) | full diff (redacted) |

> **Note:** Secrets are always redacted before storage regardless of capture level. At `redacted` level, user prompts are processed through RAKE keyword extraction — only statistically significant phrases are stored, not the full text. AI responses are never captured below `full` level. Defense-in-depth: hooks apply the captureLevel gate *before* writing to disk, and the ingest pipeline enforces it again as a second layer.

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

**Search Engine:** Locus uses SQLite FTS5 for full-text search when available. FTS5 indexes are self-healing — if the database was created without FTS5 and later opened with FTS5 available, indexes are auto-created and populated on startup. If your Node.js build doesn't include FTS5, search automatically falls back to LIKE queries (slower, less accurate). Run `memory_doctor` to check your search engine status.

## Security

Locus uses a 4-layer security model:

1. **Metadata-only** — by default, only file paths, exports, and imports are stored. No raw file content is written to disk.
2. **File denylist** — `.env`, `*.key`, `credentials.*`, and other sensitive patterns are never indexed — enforced in both the structural scanner and the conversation ingest pipeline.
3. **Content redaction** — passwords, API keys, and tokens are automatically stripped from any content before storage. Redaction is applied twice: once in hooks before writing to disk, and again in the ingest pipeline before database storage.
4. **Audit UX** — the `memory_audit` tool shows exactly what is stored for the current project and flags any security concerns.

## Architecture

```
+------------------------------------------+
|         AI Coding Tool Session           |
|  (Claude Code / Codex CLI / Cursor / ..) |
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
|     Client-aware path resolution:        |
|     Claude: ~/.claude/memory/locus-{h}/  |
|     Codex:  $CODEX_HOME/memory/locus-{h}/|
|     Other:  ~/.locus/memory/locus-{h}/   |
+------------------------------------------+
|   4-Phase Ingest Pipeline                |
|   Intake -> Filter -> Transform -> Store |
+------------------------------------------+
|   Adapters (event sources):              |
|   Claude Code hooks (v3.0)               |
|   Codex JSONL adapter + auto/manual      |
|   import into inbox before search        |
|   log-tailer / cli-wrapper (v3.2)        |
|   -> inbox/ (atomic JSON events)         |
+------------------------------------------+
```

- **Structural memory**: regex-parsed exports and imports with confidence tagging
- **Semantic memory**: user-curated decisions, automatically redacted before storage
- **Episodic memory**: hook captures, lazy-compressed when the token count exceeds the threshold
- **Conversation events**: passively captured via adapters and indexed for search
- **Storage**: node:sqlite (Node 22+) primary, sql.js fallback
- **FTS5**: full-text search across all layers, auto-detected at startup
- **Monorepo**: `@locus/core` (MCP server) + `@locus/shared-runtime` (path resolution) + `@locus/claude-code` (hooks) + `@locus/codex` (skill + JSONL adapter + config)

## FAQ

### What works without hooks (Cursor, Windsurf, Cline, Zed)?

The MCP server is fully functional without hooks. Here's what you get:

**Works out of the box:**

| Tool | What it does |
|------|-------------|
| `memory_scan` | Scans your project, builds a structural map of files, exports, and imports |
| `memory_explore` | Navigate the project structure interactively |
| `memory_search` | Full-text search across project structure and saved decisions |
| `memory_remember` | Store architecture decisions ("why Redis not Memcached?") |
| `memory_forget` | Delete stored decisions |
| `memory_doctor` | 12-point health check of the environment |
| `memory_status` | Runtime stats, DB info, configuration |
| `memory_config` | Show current settings and their sources |
| `memory_audit` | Data inventory and security review |
| `memory_purge` | Wipe all project memory (two-step safety) |

These 10 tools cover the structural and semantic memory layers — your AI assistant will remember your project structure and decisions between sessions without any hooks.

**Requires hooks (Claude Code only in v3.0):**

| Tool | What it needs |
|------|--------------|
| `memory_timeline` | Conversation events captured by hooks |
| `memory_search` with `timeRange`, `filePath`, `kind` filters | Conversation event data |
| `memory://recent` resource (conversation stats section) | Activity data from hooks |

The conversation layer (Carbon Copy) passively records what files you touched, what tools were used, and optionally what you asked — but this requires hooks to write events into the inbox. Without hooks, these features return empty results.

**Bottom line:** ~75% of tools work fully without hooks. The core value — "AI remembers your project between sessions" — works everywhere. Passive conversation history is the part that needs hooks, and IDE adapter support is coming in v3.2.

### How is Locus different from CLAUDE.md?

They complement each other. `CLAUDE.md` is for static rules — coding conventions, architecture constraints, things that rarely change. Locus is for dynamic knowledge — current project state, evolving decisions, session history. Put "always use single quotes" in `CLAUDE.md`. Use `memory_remember` for "we chose JWT over sessions because the API is stateless".

### Does Locus send my code anywhere?

No. Locus runs entirely locally. Your data is stored on your machine in a client-specific directory (`~/.claude/memory/` for Claude Code, `$CODEX_HOME/memory/` for Codex CLI, or `~/.locus/memory/` for other tools). Override with `LOCUS_STORAGE_ROOT` to share memory across clients. No network requests, no telemetry, no cloud storage. The MCP server communicates only with the AI client via stdio.

### What about secrets and sensitive files?

Locus has 4 layers of protection: (1) metadata-only storage by default — no file content stored, (2) file denylist — `.env`, `*.key`, credentials are never indexed, (3) automatic secret redaction — API keys and passwords are stripped before storage, (4) `memory_audit` tool to review what's stored. See the [Security](#security) section for details.

### When will Cursor / Windsurf get full hook support?

Version 3.2 will include `@locus/log-tailer` — an adapter that reads IDE log files and writes events to the same inbox that the Claude Code hooks use. The ingest pipeline is already built and ready; only the event source adapter is needed. See the [Roadmap](#roadmap) below.

## Roadmap

| Version | Status | Highlights |
|---------|--------|------------|
| v3.0 | Released | Carbon Copy capture, 4-phase ingest, FTS5 conversation search, 12 MCP tools |
| v3.0.5 | Released | FTS5 self-healing indexes, 12-point doctor, FTS health audit |
| v3.1 | Released | Multi-client architecture: `@locus/shared-runtime` (client-aware paths), `@locus/codex` (Codex CLI skill + config), 863 tests |
| v3.1.1 | **Current** | Fix: hooks failed in plugin cache due to bare module import of `@locus/shared-runtime` |
| v3.2 | Planned | Codex auto-import polish + skill upgrade, `@locus/log-tailer` (Cursor/Windsurf), npm package for `npx` install |
| v4.0 | Planned | HTML dashboard for memory visualization |

## Development

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install

npm test            # 863 tests (vitest)
npm run typecheck   # TypeScript strict mode
npm run lint        # Biome linter
npm run build       # Bundle -> dist/server.js (~1.1 MB)
npm run check       # All of the above
```

## License

MIT — see [LICENSE](LICENSE)
