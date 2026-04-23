# Locus

> Persistent project-aware memory for AI coding tools. Built on [MCP](https://modelcontextprotocol.io). Works with Claude Code, Codex CLI, Cursor, Windsurf, and any MCP-compatible client.

![Locus hero image](docs/assets/social-preview-github.jpg)

[![npm version](https://img.shields.io/npm/v/locus-memory)](https://www.npmjs.com/package/locus-memory)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-vitest-brightgreen)](https://github.com/Magnifico4625/locus)
[![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io)

## What is Locus?

AI coding tools lose context between sessions. Every new conversation starts from scratch — no memory of your architecture decisions, no awareness of which files exist, no record of what changed last week.

Locus solves this with three persistent memory layers:

- **Structural** — an auto-parsed map of files, exports, and imports, built from regex analysis of your codebase. Zero tokens consumed, always up to date.
- **Semantic** — decisions you save explicitly ("why JWT not sessions?", "why Postgres not Mongo?") with optional tags. Automatically redacted before storage.
- **Episodic** — a compressed history of what happened in each session: tools used, files changed, context captured via hooks.

**New in v3.0 — Carbon Copy:** Zero-cost passive capture of prompts, AI responses, and file changes via an inbox-based event protocol. A 4-phase ingest pipeline processes events into searchable conversation history — no tokens consumed on write, only on recall.

**New in v3.4 — Codex Memory Trust:** Codex CLI now has validated practical conversational recall in `redacted` mode. Live Codex dialogue can be imported from rollout JSONL, searched through `memory_search`, and summarized through `memory_recall` without requiring explicit `memory_remember`.

**Track A Codex recall truth:** Codex CLI is the primary validated path for useful recall. `metadata` remains the safe default for diagnostics and minimal capture, but it is not strong conversational memory. For practical Codex recall, use `LOCUS_CODEX_CAPTURE=redacted` with `LOCUS_CAPTURE_LEVEL=redacted`. `full` is available only as explicit warning territory.

Locus stores metadata only by default. No raw file content is ever written to disk unless you explicitly opt in.

## Compatibility

Locus is an MCP server. It works with any tool that supports the [Model Context Protocol](https://modelcontextprotocol.io).

| Feature | Claude Code | Codex CLI | Cursor / Windsurf / Cline / Zed |
|---------|-------------|-----------|----------------------------------|
| 14 MCP tools (search, recall, explore, remember...) | Full support | Full support | Full support |
| 3 MCP resources (project-map, decisions, recent) | Auto-injected | On demand | Manual config |
| Carbon Copy capture | Full support via hooks (v3.0) | Auto-import before `memory_search` + manual `memory_import_codex`; useful recall validated in `redacted` mode | Future adapters planned |

**How it works:** The MCP server provides 14 tools and 3 resources to any connected client. Storage location is auto-detected per client (`~/.claude/memory/` for Claude Code, `$CODEX_HOME/memory/` for Codex CLI, `~/.locus/memory/` for others). In Claude Code, three native hooks additionally capture conversation events into a local inbox for passive memory. In Codex CLI, the newest rollout session is auto-imported before `memory_search` in a bounded, debounced, best-effort way, and `memory_import_codex` remains available for explicit catch-up or filtered manual import. `memory_status` and `memory_doctor` now distinguish healthy ingest plumbing from actually useful recall.

## Features

- 3 memory layers: structural (auto-parsed), semantic (user-curated), episodic (auto-captured)
- **Carbon Copy**: passive conversation capture via inbox-based event protocol
- 14 MCP tools for exploring, recalling, searching, remembering, and managing memory
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
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
```

Repo-local plugin packaging is also available for local Codex onboarding:

- plugin bundle: [plugins/locus-memory](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/plugins/locus-memory)
- repo marketplace: [.agents/plugins/marketplace.json](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/.agents/plugins/marketplace.json)
- plugin sync helper: `npm run sync:codex-plugin`

> **Note:** Codex CLI storage goes to `$CODEX_HOME/memory/`. All 14 MCP tools and 3 resources work immediately. Before `memory_search`, Locus auto-imports the newest Codex rollout session with a local debounce window. `memory_status` now exposes structured Codex diagnostics plus `codexTruth`, `memory_doctor` adds Codex-specific health checks, and `memory_import_codex` remains available when you want explicit control, filtered import, or manual catch-up across older sessions.
> Last documented validation target: Codex CLI `0.123.0` surface as of April 23, 2026.

Manual MCP setup remains fully supported. The local plugin bundle is an optional packaging layer for repo-local onboarding, not a replacement requirement.

Recent Codex history becomes searchable automatically when you use `memory_search`, but recall quality depends on capture mode. `metadata` proves import health and preserves limited session context. `redacted` is the recommended practical mode for useful conversational recall. `full` stores the most content and must be treated as explicit opt-in.

`memory_recall` is summary-first and can recover useful Codex context from imported conversation events and durable decisions. If several events match the same question, it may return `needs_clarification`; that is expected when the same marker or decision appears in prompts, session summaries, and follow-up diagnostics.

Recommended Codex workflow:

- use `memory_search` first when recalling recent work, prior decisions, or recent Codex dialogue
- use `memory_recall` for summary-first questions like "what did we do yesterday?" or "what did we decide about auth?"
- use `memory_status` to inspect `codexAutoImport` and `codexDiagnostics` if recent dialogue does not appear as expected
- use `memory_doctor` for actionable Codex checks when you need to diagnose session discovery, rollout readability, capture mode, or imported-event counts
- use `memory_import_codex` only for older sessions, filtered imports, or explicit manual catch-up
- use `memory_remember` for important architectural decisions and why they were made

Common Codex fixes:

- confirm `CODEX_HOME` points at the active Codex home directory
- confirm `$CODEX_HOME/sessions/` exists and contains `rollout-*.jsonl` files
- confirm `LOCUS_CODEX_CAPTURE` is not set to `off`
- if `memory_status.codexTruth.recallReadiness` is `limited`, switch Codex to `redacted` capture for practical recall
- use `memory_search` first, then `memory_status`, then `memory_doctor`, and only then run `memory_import_codex` for manual catch-up

To keep the locally installed Codex skill aligned with the repo copy:

```bash
npm run sync:codex-skill
```

To keep the repo-local Codex plugin bundle aligned with the canonical skill:

```bash
npm run sync:codex-plugin
```

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

### Codex VS Code Extension

The Codex VS Code extension uses the same Codex MCP configuration model as Codex CLI. In practice, this means Locus can work there through the same server setup, but MCP visibility in the extension may still depend on upstream preview behavior.

Treat Codex CLI as the primary validated path. Desktop/extension parity is intentionally reported as unverified until tested in that surface. If the extension does not expose Locus tools in a given build, that is an IDE integration boundary, not a separate Locus skill format.

Use the dedicated guide for setup, reload, verification, and troubleshooting:

- [Codex VS Code Extension](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-vscode-extension.md)

Recommended diagnosis order in the extension:

- run `memory_search` first
- inspect `memory_status`
- inspect `memory_doctor`
- use `memory_import_codex` only for explicit manual catch-up

The repo-local plugin bundle can support local Codex onboarding here too, but manual MCP setup remains the documented fallback if extension/plugin behavior differs from Codex CLI in a given build.

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

> **Note:** When using Locus outside Claude Code, the MCP tools and resources work fully. Codex CLI additionally supports auto-import before `memory_search` plus manual session import via `memory_import_codex`. Adapter support for IDE log files in Cursor, Windsurf, and similar clients remains a future track.

For other MCP IDEs, Locus works through MCP tools/resources. The Codex-specific skill is not the primary integration mechanism there.

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
| `memory_review` | `state?, topicKey?, limit?` | Inspect durable memories that may need review, cleanup, or archival |
| `memory_forget` | `query: string, confirmToken?: string` | Delete matching memories (bulk-delete safety) |
| `memory_scan` | — | Scan project and index code structure |
| `memory_status` | — | Runtime stats, config, inbox metrics, DB info, and Codex diagnostics when `CODEX_HOME` is present |
| `memory_doctor` | — | 12-point environment health check plus Codex-specific checks when `CODEX_HOME` is present |
| `memory_audit` | — | Data inventory and security audit |
| `memory_config` | — | Show current configuration and sources |
| `memory_compact` | `maxAgeDays?, keepSessions?` | Clean up old episodic memory entries |
| `memory_purge` | `confirmToken?: string` | Clear all project memory (two-step confirmation) |
| `memory_timeline` | `timeRange?, kind?, filePath?, summary?` | Chronological event feed with optional summary mode |
| `memory_import_codex` | `latestOnly?, projectRoot?, sessionId?, since?` | Manually import Codex rollout JSONL sessions into inbox and storage |
| `memory_recall` | `question: string, timeRange?, limit?` | Summary-first recall over recent conversation context and durable decisions |

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
| `CODEX_HOME` | filesystem path | platform default | Codex home used for `sessions/`, installed skills, and Codex-specific storage paths |

**Capture Levels:**

| Level | Tool Use | User Prompts | AI Responses | File Diffs |
|-------|----------|-------------|-------------|------------|
| `metadata` (default) | stats only | Filtered | Filtered | stats only |
| `redacted` | + error kind, command name | keywords only (RAKE) | Filtered | stats only |
| `full` | + full command (redacted) | full text (redacted) | full text (redacted) | full diff (redacted) |

> **Note:** Secrets are always redacted before storage regardless of capture level. At `redacted` level, user prompts are processed through RAKE keyword extraction — only statistically significant phrases are stored, not the full text. AI responses are never captured below `full` level. Defense-in-depth: hooks apply the captureLevel gate *before* writing to disk, and the ingest pipeline enforces it again as a second layer.

For Codex specifically, read the modes as product behavior:

- `metadata`: safe default and diagnostics-first mode; limited conversational recall.
- `redacted`: recommended practical mode for useful Codex recall; stores bounded, filtered, best-effort-redacted snippets.
- `full`: maximum recall with raw conversation text after best-effort redaction; explicit opt-in only.

See [Codex Acceptance Matrix](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-acceptance-matrix.md) for the current validation status.

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
|            14 MCP Tools                  |
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
|   log-tailer / cli-wrapper (future)      |
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

These tools cover the structural and semantic memory layers — your AI assistant will remember your project structure and decisions between sessions without any hooks.

**Requires a capture adapter:**

| Tool | What it needs |
|------|--------------|
| `memory_timeline` | Conversation events captured by Claude hooks or Codex JSONL import |
| `memory_search` with `timeRange`, `filePath`, `kind` filters | Conversation event data |
| `memory_recall` over recent dialogue | Conversation events plus durable decisions |
| `memory://recent` resource (conversation stats section) | Activity data from a capture adapter |

The conversation layer (Carbon Copy) passively records what files you touched, what tools were used, and optionally what you asked. Claude Code writes through hooks. Codex CLI uses rollout JSONL import with auto-import before search/recall plus manual `memory_import_codex`. Other IDEs still need future adapter work for passive conversation capture.

**Bottom line:** the core value — "AI remembers your project between sessions" — works anywhere MCP tools are exposed. Passive conversation history works today for Claude Code and Codex CLI; broader IDE adapter support remains a future release track.

### How is Locus different from CLAUDE.md?

They complement each other. `CLAUDE.md` is for static rules — coding conventions, architecture constraints, things that rarely change. Locus is for dynamic knowledge — current project state, evolving decisions, session history. Put "always use single quotes" in `CLAUDE.md`. Use `memory_remember` for "we chose JWT over sessions because the API is stateless".

### Does Locus send my code anywhere?

No. Locus runs entirely locally. Your data is stored on your machine in a client-specific directory (`~/.claude/memory/` for Claude Code, `$CODEX_HOME/memory/` for Codex CLI, or `~/.locus/memory/` for other tools). Override with `LOCUS_STORAGE_ROOT` to share memory across clients. No network requests, no telemetry, no cloud storage. The MCP server communicates only with the AI client via stdio.

### What about secrets and sensitive files?

Locus has 4 layers of protection: (1) metadata-only storage by default — no file content stored, (2) file denylist — `.env`, `*.key`, credentials are never indexed, (3) automatic secret redaction — API keys and passwords are stripped before storage, (4) `memory_audit` tool to review what's stored. See the [Security](#security) section for details.

### When will Cursor / Windsurf get full hook support?

The next Codex-focused release track will target one-command install, marketplace packaging, recall ranking polish, and additional IDE adapters such as `@locus/log-tailer`. See the [Roadmap](#roadmap) below.

## Roadmap

| Version | Status | Highlights |
|---------|--------|------------|
| v3.0 | Released | Carbon Copy capture, 4-phase ingest, FTS5 conversation search, 12 MCP tools |
| v3.0.5 | Released | FTS5 self-healing indexes, 12-point doctor, FTS health audit |
| v3.1 | Released | Multi-client architecture: `@locus/shared-runtime` (client-aware paths), `@locus/codex` (Codex CLI skill + config) |
| v3.1.1 | Released | Fix: hooks failed in plugin cache due to bare module import of `@locus/shared-runtime` |
| v3.3 | Released | Codex release: manual import, auto-import before search, doctor/status diagnostics, skill sync, VS Code docs, repo-local plugin packaging |
| v3.4 | **Current** | Codex memory trust release: validated useful recall in `redacted`, current Codex JSONL compatibility, honest diagnostics/docs |
| v4.0 | Planned | HTML dashboard for memory visualization |

## Development

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install

npm test            # vitest suite
npm run typecheck   # TypeScript strict mode
npm run lint        # Biome linter
npm run build       # Bundle -> dist/server.js (~1.1 MB)
npm run check       # All of the above
```

## License

MIT — see [LICENSE](LICENSE)
