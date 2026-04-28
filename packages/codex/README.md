# @locus/codex

Codex CLI adapter for [Locus](https://github.com/Magnifico4625/locus) persistent memory.

## Quick Start

### 1. Install for Codex

```bash
npx -y locus-memory@latest install codex
```

The installer writes the canonical skill to `$CODEX_HOME/skills/locus-memory/SKILL.md` and configures the `locus` MCP server with `redacted` capture defaults.

### 2. Verify and diagnose

```bash
npx -y locus-memory@latest doctor codex
```

Then restart Codex and ask for `memory_status` or a small `memory_search`.

### 3. Uninstall MCP entry

```bash
npx -y locus-memory@latest uninstall codex --yes
```

Uninstall removes the package-owned MCP entry but leaves local memory data untouched.

### Manual MCP fallback

Manual setup is still supported for development checkouts and users who prefer direct MCP config:

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or edit `~/.codex/config.toml` directly (see `config/config.toml.example`).

### Skill-only sync fallback

Sync the canonical repo skill into your local Codex skills directory:

```bash
npm run sync:codex-skill
```

This writes `packages/codex/skills/locus-memory/SKILL.md` into `$CODEX_HOME/skills/locus-memory/SKILL.md`, usually `~/.codex/skills/locus-memory/SKILL.md`.

### Repo-local plugin and marketplace bundles

The repo also contains a local plugin bundle:

- plugin bundle: [plugins/locus-memory](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/plugins/locus-memory)
- repo marketplace: [.agents/plugins/marketplace.json](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/.agents/plugins/marketplace.json)
- generated public marketplace bundle: `dist/marketplace/`

To keep the plugin bundle aligned with the canonical skill:

```bash
npm run sync:codex-plugin
npm run sync:codex-marketplace
```

Command roles:

- `npm run sync:codex-plugin` updates the repo-local plugin bundle
- `npm run sync:codex-marketplace` generates the public distribution bundle without committing or pushing another repository
- `npm run sync:codex-skill` updates the installed skill-only path for manual MCP setups

For useful conversational recall, configure Codex with `redacted` capture:

```toml
[mcp_servers.locus.env]
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
```

## What Works

- All 14 MCP tools (including `memory_recall` and `memory_import_codex`)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`
- Auto-import before `memory_search`, plus manual and library JSONL import for Codex session rollout files
- Canonical Codex skill workflow for `memory_search`, `memory_status`, `memory_remember`, and manual `memory_import_codex`
- Codex-aware diagnostics in `memory_status` and `memory_doctor`
- Summary-first recall through `memory_recall`
- `codexTruth` status guidance that separates import health from recall usefulness

Last documented recall validation target: Codex CLI `0.123.0` surface as of April 23, 2026. Install smoke during Track B used Codex CLI `0.125.0` locally before npm publish.

Codex CLI is the primary validated path. Codex desktop / extension uses the same MCP model where exposed by the upstream surface, but parity is reported as unverified until checked there.

## Codex JSONL Import

Phase 1 built the adapter foundation. Phase 2 exposed it through MCP. Phase 3 added bounded auto-import before `memory_search`. Track A adds acceptance-backed truth: `metadata` is limited recall, `redacted` is the recommended practical mode, and diagnostics must say when desktop/extension parity is unverified. `v3.4.0` also validates current Codex payload-wrapped JSONL records and prevents `memory_recall` from missing older matching conversation events just because they are outside the recent timeline window.

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
- `memory_recall` for summary-first questions like "what did we do yesterday?"
- `memory_status` when recent history does not appear as expected
- `memory_import_codex` only for manual catch-up, filtered imports, or older sessions
- `memory_remember` for architectural decisions, trade-offs, and reasons behind the chosen path
- `memory_scan` after large project-structure changes

This workflow is optimized and validated for Codex CLI. In the Codex VS Code extension, the same MCP setup may work when the extension exposes MCP tools, but that still depends on upstream preview support.

For the extension-specific setup, reload, and troubleshooting flow, use the dedicated guide:

- [Codex VS Code Extension](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-vscode-extension.md)

### Diagnosis workflow

When recent Codex dialogue does not show up as expected:

1. Run `memory_search` first so bounded auto-import gets a chance to pull the newest rollout.
2. Run `memory_status` and inspect `codexAutoImport`, `codexDiagnostics`, and `codexTruth`.
3. Run `memory_doctor` for actionable checks and suggested fixes.
4. Use `memory_import_codex` only if you need explicit manual catch-up or filtered import.

Common fixes:

- verify `CODEX_HOME` points at the Codex home you are actively using
- verify `$CODEX_HOME/sessions/` exists and contains `rollout-*.jsonl`
- verify the latest rollout file is readable by the current process
- verify `LOCUS_CODEX_CAPTURE` is not `off`
- if `codexTruth.recallReadiness` is `limited`, switch to `redacted` for practical recall
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
  captureMode: 'redacted',
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

For practical recall, use `redacted` instead:

```toml
[mcp_servers.locus.env]
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
```

Supported values:

| Value | Behavior |
|-------|----------|
| `off` | Do not import Codex session JSONL events |
| `metadata` | Default. Import session/tool metadata only; useful for diagnostics but limited for conversational recall |
| `redacted` | Recommended for practical recall. Import bounded, filtered, best-effort-redacted snippets while preserving privacy boundaries |
| `full` | Maximum recall. Import user prompt and assistant response text after redaction; explicit opt-in warning territory |

`LOCUS_CODEX_CAPTURE` controls the Codex adapter before events are written to inbox. `LOCUS_CAPTURE_LEVEL` remains the core ingest pipeline's second-defense gate.
If `LOCUS_CODEX_CAPTURE=off`, both auto-import before `memory_search` and `memory_import_codex` are disabled.

Redaction is best-effort by design: obvious API keys, bearer tokens, and similar secrets are stripped before storage, but arbitrary free-form text can never be guaranteed perfectly secret-free.

See [Codex Acceptance Matrix](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-acceptance-matrix.md) for the current CLI, desktop/extension, manual fallback, and capture-mode validation status.

## What's Coming

- Codex desktop / extension validation for the registry-hosted `locus-memory@3.5.2` runtime
- recall ranking polish for duplicate-heavy sessions
- dashboard and secondary IDE adapter work after the Codex-first path is strong
