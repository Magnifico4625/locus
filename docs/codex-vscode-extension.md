# Codex VS Code Extension

This guide explains how to use Locus with the Codex VS Code extension.

It covers:

- how to add Locus as an MCP server for Codex
- how to reload VS Code after config changes
- how to verify that Locus tools are visible and working
- how to diagnose missing recent Codex memory
- what still depends on upstream Codex extension behavior

## What Works Today

When the Codex VS Code extension exposes the same Codex MCP surface as Codex CLI, Locus works through the same MCP server setup:

- all 13 MCP tools
- all 3 MCP resources
- Codex auto-import before `memory_search`
- manual import through `memory_import_codex`
- Codex diagnostics through `memory_status` and `memory_doctor`

Codex CLI remains the primary validated path. The VS Code extension uses the same configuration model, but extension-side MCP visibility can still vary by upstream preview build.

## Prerequisites

- Node.js `>= 22`
- a local Locus checkout with built server output in `dist/server.js`
- Codex installed and signed in
- access to the Codex configuration used by the extension

## Add Locus As An MCP Server

Preferred path:

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Optional repo-local plugin packaging also exists in this repository:

- plugin bundle: [plugins/locus-memory](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/plugins/locus-memory)
- repo marketplace: [.agents/plugins/marketplace.json](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/.agents/plugins/marketplace.json)
- sync helper: `npm run sync:codex-plugin`

Treat that plugin bundle as an extra local onboarding path. Manual MCP setup stays the stable documented fallback.

Equivalent config in `~/.codex/config.toml`:

```toml
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
LOCUS_CODEX_CAPTURE = "metadata"
LOCUS_CAPTURE_LEVEL = "metadata"
```

Windows note:

- in TOML, use forward slashes like `C:/Users/Admin/gemini-project/ClaudeMagnificoMem/dist/server.js`
- or use escaped backslashes like `C:\\Users\\Admin\\gemini-project\\ClaudeMagnificoMem\\dist\\server.js`
- avoid raw backslashes such as `C:\Users\...` inside TOML strings, because they can break parsing or prevent the MCP server from starting

## Restart And Reload

After changing Codex MCP configuration:

1. save `~/.codex/config.toml`
2. in VS Code, run `Developer: Reload Window`
3. reopen the Codex chat after the window reload completes

Closing only the chat tab is not enough. The MCP client usually needs a full window reload to pick up config changes.

If `Reload Window` is not enough, fully restart VS Code and reopen the Codex extension.

## Verify Inside Codex

Use this order:

1. Ask Codex to run `memory_search` for a recent project topic.
2. If recent memory does not appear, run `memory_status`.
3. If the state still looks wrong, run `memory_doctor`.
4. Use `memory_import_codex({"latestOnly":true})` only if you need explicit manual catch-up.

Text-based success example for `memory_status`:

```json
{
  "codexAutoImport": {
    "lastStatus": "imported"
  },
  "codexDiagnostics": {
    "sessionsDirExists": true,
    "rolloutFilesFound": 3,
    "latestRolloutReadable": true,
    "captureMode": "metadata",
    "importedEventCount": 42
  }
}
```

You do not need this exact payload shape in the UI, but you should see the same signals:

- `codexDiagnostics` exists
- `sessionsDirExists` is `true`
- `rolloutFilesFound` is greater than `0`
- `latestRolloutReadable` is `true`
- `captureMode` is not `off`

## Diagnose Missing Recent Memory

If recent Codex dialogue is missing:

1. run `memory_search` first so Locus can try bounded auto-import
2. inspect `memory_status`
3. inspect `memory_doctor`
4. only then run `memory_import_codex`

Common causes:

- `CODEX_HOME` points to the wrong Codex home
- `$CODEX_HOME/sessions/` does not exist yet
- no `rollout-*.jsonl` files exist yet
- the latest rollout file is not readable
- `LOCUS_CODEX_CAPTURE=off`
- the extension has not reloaded its MCP configuration yet

## What Requires The Codex JSONL Adapter

Recent Codex conversation recall depends on the existing Codex JSONL import path:

- auto-import before `memory_search`
- manual import through `memory_import_codex`
- `LOCUS_CODEX_CAPTURE`

This is local Locus behavior. It does not depend on a VS Code-specific adapter.

## Known Limitations

Locus cannot fix these extension-side conditions:

- the current VS Code Codex build does not expose MCP tools or resources
- the extension has not reloaded updated MCP config yet
- the extension preview behaves differently from Codex CLI in that build

If the extension does not expose Locus tools at all, verify the same setup in Codex CLI first. If CLI works and the extension does not, that is an upstream extension boundary rather than a separate Locus runtime issue.

The repo-local plugin bundle does not remove that boundary. It can help package the same skill and MCP guidance, but it does not guarantee extension-side MCP visibility in builds where upstream preview behavior differs.
