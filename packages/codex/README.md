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

- All 13 MCP tools (including `memory_import_codex`)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`
- Manual and library JSONL import for Codex session rollout files

## Codex JSONL Import

Phase 1 built the adapter foundation. Phase 2 exposes it through MCP.

### Manual import from Codex

Run the tool from Codex when you want recent session history ingested immediately:

```text
memory_import_codex({"latestOnly":true})
```

Available filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `latestOnly` | `boolean` | Import only the newest rollout file in the discovered session set |
| `projectRoot` | `string` | Keep only events whose normalized Codex project root matches |
| `sessionId` | `string` | Keep only one Codex session id |
| `since` | `number` | Keep only events at or after the given Unix timestamp in milliseconds |

After the tool writes inbox events, core immediately runs `processInbox()`, so imported Codex dialogue is searchable through `memory_search` in the same session.

### Library API

The lower-level library API remains available:

```ts
import { importCodexSessionsToInbox } from '@locus/codex';

const metrics = importCodexSessionsToInbox({
  sessionsDir: 'C:/Users/Admin/.codex/sessions',
  inboxDir: 'C:/path/to/locus-project-inbox',
  captureMode: 'metadata',
});
```

The importer reads `rollout-*.jsonl` files from `$CODEX_HOME/sessions` by default, normalizes Codex session records, writes Locus `InboxEvent v1` files, and lets the existing core ingest pipeline store them. It also supports optional filters and a dedup callback for already-ingested `event_id` values.

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
If `LOCUS_CODEX_CAPTURE=off`, `memory_import_codex` returns a disabled response and performs no import work.

Redaction is best-effort by design: obvious API keys, bearer tokens, and similar secrets are stripped before storage, but arbitrary free-form text can never be guaranteed perfectly secret-free.

## What's Coming

- Auto-import before search
- Codex-aware doctor/status diagnostics
- npm package for `npx` one-liner install
