# @locus/codex

Codex CLI adapter for [Locus](https://github.com/Magnifico4625/locus) persistent memory.

## Quick Start

### 1. Add MCP Server

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or edit `~/.codex/config.toml` directly (see `config/config.toml.example`).

### 2. Install Skill (optional)

Sync the canonical repo skill into your local Codex skills directory:

```bash
npm run sync:codex-skill
```

This writes `packages/codex/skills/locus-memory/SKILL.md` into `$CODEX_HOME/skills/locus-memory/SKILL.md`, usually `~/.codex/skills/locus-memory/SKILL.md`.

### 2a. Repo-Local Plugin Bundle (optional)

The repo also contains a local plugin bundle:

- plugin bundle: [plugins/locus-memory](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/plugins/locus-memory)
- repo marketplace: [.agents/plugins/marketplace.json](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/.agents/plugins/marketplace.json)

To keep the plugin bundle aligned with the canonical skill:

```bash
npm run sync:codex-plugin
```

Command roles:

- `npm run sync:codex-plugin` updates the repo-local plugin bundle
- `npm run sync:codex-skill` updates the installed skill-only path for manual MCP setups

### 3. Verify

```bash
codex "Search memory for recent decisions"
```

## What Works

- All 13 MCP tools (including `memory_import_codex`)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`
- Auto-import before `memory_search`, plus manual and library JSONL import for Codex session rollout files
- Canonical Codex skill workflow for `memory_search`, `memory_status`, `memory_remember`, and manual `memory_import_codex`
- Codex-aware diagnostics in `memory_status` and `memory_doctor`

Validated against the current Codex docs generation and Codex CLI `0.120.0` surface as of April 13, 2026.

## Codex JSONL Import

Phase 1 built the adapter foundation. Phase 2 exposed it through MCP. Phase 3 adds bounded auto-import before `memory_search`.

### Auto-import before search

When Codex is the detected client environment, core auto-imports only the newest rollout file before `memory_search`.

Behavior:

- search-triggered, not a background watcher
- bounded to the newest discovered rollout session
- debounced in the server process to avoid repeated re-import during active querying
- best-effort: if import is disabled or fails, search still runs

Use `memory_status` to inspect both the last auto-import snapshot and the current Codex diagnostics snapshot.

### Skill workflow

The canonical Locus Codex skill assumes this workflow:

- `memory_search` first for project recall and recent Codex dialogue
- `memory_status` when recent history does not appear as expected
- `memory_import_codex` only for manual catch-up, filtered imports, or older sessions
- `memory_remember` for architectural decisions, trade-offs, and reasons behind the chosen path
- `memory_scan` after large project-structure changes

This workflow is optimized for Codex CLI. In the Codex VS Code extension, the same MCP setup may work when the extension exposes MCP tools, but that still depends on upstream preview support.

For the extension-specific setup, reload, and troubleshooting flow, use the dedicated guide:

- [Codex VS Code Extension](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-vscode-extension.md)

### Diagnosis workflow

When recent Codex dialogue does not show up as expected:

1. Run `memory_search` first so bounded auto-import gets a chance to pull the newest rollout.
2. Run `memory_status` and inspect `codexAutoImport` plus `codexDiagnostics`.
3. Run `memory_doctor` for actionable checks and suggested fixes.
4. Use `memory_import_codex` only if you need explicit manual catch-up or filtered import.

Common fixes:

- verify `CODEX_HOME` points at the Codex home you are actively using
- verify `$CODEX_HOME/sessions/` exists and contains `rollout-*.jsonl`
- verify the latest rollout file is readable by the current process
- verify `LOCUS_CODEX_CAPTURE` is not `off`
- verify imported-event counts increase after `memory_search` or `memory_import_codex`
- reload the VS Code window after MCP config changes if you are using the extension

### Manual import from Codex

Run the tool from Codex when you want explicit control over import scope or want to catch up older rollout history beyond the newest auto-imported session:

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
If `LOCUS_CODEX_CAPTURE=off`, both auto-import before `memory_search` and `memory_import_codex` are disabled.

Redaction is best-effort by design: obvious API keys, bearer tokens, and similar secrets are stripped before storage, but arbitrary free-form text can never be guaranteed perfectly secret-free.

## What's Coming

- self-serve public plugin publishing is still not the target path here; Phase 7 is repo-local packaging only
- npm package for `npx` one-liner install
