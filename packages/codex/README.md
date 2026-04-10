# @locus/codex

Codex CLI adapter for [Locus](https://github.com/Magnifico4625/locus) persistent memory.

## Quick Start

### 1. Add MCP Server

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or edit `~/.codex/config.toml` directly (see `config/config.toml.example`).

### 2. Install Skill (optional)

Copy `skills/locus-memory/` to `$CODEX_HOME/skills/locus-memory/`, usually `~/.codex/skills/locus-memory/`.

### 3. Verify

```bash
codex "Search memory for recent decisions"
```

## What Works

- All 12 MCP tools (memory_search, memory_remember, memory_explore, etc.)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`
- Library JSONL importer for Codex session rollout files

## Codex JSONL Importer

Phase 1 provides a library importer:

```ts
import { importCodexSessionsToInbox } from '@locus/codex';

const metrics = importCodexSessionsToInbox({
  sessionsDir: 'C:/Users/Admin/.codex/sessions',
  inboxDir: 'C:/path/to/locus-project-inbox',
  captureMode: 'metadata',
});
```

The importer reads `rollout-*.jsonl` files from `$CODEX_HOME/sessions` by default, normalizes Codex session records, writes Locus `InboxEvent v1` files, and lets the existing core ingest pipeline store them.

Important Phase 1 limitation: this is a library API only. There is not yet a `memory_import_codex` MCP tool, and Codex conversations are not auto-imported before `memory_search`. Phase 2 should expose this importer through MCP by calling `importCodexSessionsToInbox()`.

## Capture Modes

Set `LOCUS_CODEX_CAPTURE` in the Codex MCP server environment:

```toml
[mcp_servers.locus.env]
CODEX_HOME = 'C:\Users\Admin\.codex'
LOCUS_CODEX_CAPTURE = "metadata"
LOCUS_CAPTURE_LEVEL = "metadata"
```

Supported values:

| Value | Behavior |
|-------|----------|
| `off` | Do not import Codex session JSONL events |
| `metadata` | Default. Import session/tool metadata only; do not import user prompt or assistant response text |
| `redacted` | Import user prompt text after best-effort redaction; skip assistant response text |
| `full` | Import user prompt and assistant response text after redaction |

`LOCUS_CODEX_CAPTURE` controls the Codex adapter before events are written to inbox. `LOCUS_CAPTURE_LEVEL` remains the core ingest pipeline's second-defense gate.

Phase 1 proves `memory_timeline` compatibility programmatically through core ingest tests. User-visible manual timeline inspection comes in Phase 2 after `memory_import_codex` exists.

## What's Coming

- `memory_import_codex` MCP tool for manual imports
- Auto-import before search
- npm package for `npx` one-liner install
