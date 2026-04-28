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

- all 14 MCP tools
- all 3 MCP resources
- Codex auto-import before `memory_search`
- manual import through `memory_import_codex`
- Codex diagnostics through `memory_status` and `memory_doctor`

Codex CLI remains the primary validated path. The VS Code extension uses the same configuration model, but extension-side MCP visibility can still vary by upstream preview build.
Until validated inside a specific extension build, Locus reports Codex desktop/extension parity as unverified. Treat that as a product truth signal, not a failure by itself.

## Prerequisites

- Node.js `>= 22`
- Codex installed and signed in
- access to the Codex configuration used by the extension
- for the one-command path: network access to npm during install
- for the manual fallback: a local Locus checkout with built server output in `dist/server.js`

## Add Locus As An MCP Server

Preferred path:

```bash
npx -y locus-memory@latest install codex
npx -y locus-memory@latest doctor codex
```

The installer configures Codex with the package runtime and `redacted` capture defaults. The recurring MCP command is pinned to the installed package version, not `@latest`.

Optional repo-local plugin packaging also exists in this repository:

- plugin bundle: [plugins/locus-memory](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/plugins/locus-memory)
- repo marketplace: [.agents/plugins/marketplace.json](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/.agents/plugins/marketplace.json)
- sync helper: `npm run sync:codex-plugin`

Treat that plugin bundle as an extra local onboarding path. Manual MCP setup stays the stable documented fallback.

Equivalent package-runtime config in `~/.codex/config.toml`:

```toml
[mcp_servers.locus]
command = "npx"
args = ["-y", "locus-memory@3.5.1", "mcp"]
cwd = "/home/<you>/.codex"

[mcp_servers.locus.env]
LOCUS_LOG = "error"
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
```

On Windows, use `npx.cmd`:

```toml
[mcp_servers.locus]
command = "npx.cmd"
args = ["-y", "locus-memory@3.5.1", "mcp"]
cwd = "C:\\Users\\<you>\\.codex"
```

Manual MCP fallback for local development:

```toml
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
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
2. Ask Codex to run `memory_recall` for a summary-first question such as "what did we do yesterday?"
3. If recent memory does not appear, run `memory_status`.
4. If the state still looks wrong, run `memory_doctor`.
5. Use `memory_import_codex({"latestOnly":true})` only if you need explicit manual catch-up.

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
    "captureMode": "redacted",
    "importedEventCount": 42
  },
  "codexTruth": {
    "recallReadiness": "practical",
    "recommendedCaptureMode": "redacted",
    "desktopParity": "unverified"
  }
}
```

You do not need this exact payload shape in the UI, but you should see the same signals:

- `codexDiagnostics` exists
- `sessionsDirExists` is `true`
- `rolloutFilesFound` is greater than `0`
- `latestRolloutReadable` is `true`
- `captureMode` is not `off`
- `codexTruth.recallReadiness` is `practical` for `redacted`, or `limited` for `metadata`
- `codexTruth.desktopParity` may be `unverified` even when CLI behavior is healthy

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
- `LOCUS_CODEX_CAPTURE=metadata`, which is valid for diagnostics but limited for strong recall
- the extension has not reloaded its MCP configuration yet

## What Requires The Codex JSONL Adapter

Recent Codex conversation recall depends on the existing Codex JSONL import path:

- auto-import before `memory_search`
- manual import through `memory_import_codex`
- `LOCUS_CODEX_CAPTURE`

This is local Locus behavior. It does not depend on a VS Code-specific adapter.

For practical recall, prefer `LOCUS_CODEX_CAPTURE=redacted` and `LOCUS_CAPTURE_LEVEL=redacted`. `metadata` is intentionally limited. `full` stores the most conversation content after best-effort redaction and should be used only when the user explicitly accepts that trade-off.

## Known Limitations

Locus cannot fix these extension-side conditions:

- the current VS Code Codex build does not expose MCP tools or resources
- the extension has not reloaded updated MCP config yet
- the extension preview behaves differently from Codex CLI in that build

If the extension does not expose Locus tools at all, verify the same setup in Codex CLI first. If CLI works and the extension does not, that is an upstream extension boundary rather than a separate Locus runtime issue.

The repo-local plugin bundle does not remove that boundary. It can help package the same skill and MCP guidance, but it does not guarantee extension-side MCP visibility in builds where upstream preview behavior differs.
