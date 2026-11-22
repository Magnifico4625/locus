# Locus v4 — Multi-Platform Zero-Call Desktop Plugins Roadmap & Working Contract

**Date:** 2026-11-22  
**Baseline:** `v4-plugins-baseline` (`9c006ac`, `codex/v3.7.0-publish` / `v3.7.0` + `opencode.md`)  
**Worktree:** `C:\Users\Admin\gemini-project\ClaudeMagnificoMem-v4-plugins`  
**Branch:** `feat/v4-multi-platform-plugins`

---

## 1. Goal & Target Desktop Platforms

Turn Locus into a zero-call persistent memory plugin layer across 4 primary desktop agent platforms so memory injection and capture work automatically without requiring explicit MCP tool calls on every turn:

1. **Antigravity Desktop** — Subprocess hooks (`SessionStart`, `PreInvocation` via `injectSteps`, `PostToolUse`, `Stop` via `transcriptPath`) + native plugin bundle (`plugin.json`, root `hooks.json`, `rules/AGENTS.md`, `skills/`, `mcp_config.json`).
2. **Codex Desktop** — Subprocess hooks (`SessionStart`, `UserPromptSubmit` via `hookSpecificOutput.additionalContext`, `PostToolUse`, `Stop` incremental rollout JSONL import) + `.codex-plugin/plugin.json` (`"hooks": "./hooks.json"`) with a stable versionless local runtime command so `trusted_hash` survives updates.
3. **OpenCode Desktop** — In-process ESM plugin (`experimental.chat.messages.transform`, `experimental.session.compacting`, `config` skill path registration, and real-time event capture via `chat.message`, `tool.execute.after`, `event`).
4. **DeepSeek Harness Desktop (`dsh`)** — In-process Cordis microkernel plugin (`cordis.patch.yml`, dynamic `ctx.systemPrompt.section` assembly, and event capture via `tools/post-execute`, `agent/turn-stopping`, `sessionProjections`).

### Two-Class Adapter Architecture

All 4 platforms share one canonical core (`@locus/core` + `@locus/shared-runtime`) and split cleanly into 2 thin adapter classes:

- **Subprocess Hooks (stdin/stdout JSON):** Antigravity Desktop, Codex Desktop — backed by a local pre-bundled CLI binary (`~/.locus/bin/cli.js` / `server.js`) for fast cold start (`<60 ms`) without `npx` network/wrapper overhead.
- **In-Process ESM Plugins:** OpenCode Desktop, DeepSeek Harness Desktop — importing `@locus/core` directly in-process with cached briefs and defensive SQLite concurrency handling.

MCP (`dist/server.js`) remains available as the deep-query fallback (`memory_calendar`, `memory_review`, `memory_forget`, `memory_audit`, `memory_purge`, `memory_scan`) with multi-workspace `roots/list` support.

---

## 2. Mandatory Isolation & Safety Contract

To protect the working `v3.7.0` setup and live memory databases while developing v4 across context resets:

1. **Isolated Git Worktree Only**
   - ALL edits, builds (`npm run build`), and checks (`npm run check`) MUST run strictly inside `C:\Users\Admin\gemini-project\ClaudeMagnificoMem-v4-plugins` on branch `feat/v4-multi-platform-plugins`.
   - NEVER modify files or run `npm run build` inside the primary repository `C:\Users\Admin\gemini-project\ClaudeMagnificoMem` — live Codex Desktop currently executes `dist/server.js` from that folder.
2. **Baseline Anchor Tag**
   - Branch `feat/v4-multi-platform-plugins` starts from tag `v4-plugins-baseline` (`9c006ac`).
3. **Sandbox Memory & Home Isolation**
   - Always pass isolated `LOCUS_STORAGE_ROOT` (e.g. `~/.locus-dev/memory/` or a temporary directory) and `LOCUS_HOME` during development and smoke tests.
   - NEVER touch live SQLite databases under `~/.codex/memory/`, `~/.claude/memory/`, or `~/.locus/memory/`, nor `~/.locus/bin/`, until explicit user approval.
4. **Config Backups Before Any Live Desktop Test**
   - Before touching any desktop app configuration during live validation, create timestamped backups of:
     - `~/.codex/config.toml` (and `~/.codex/hooks.json` if present)
     - `~/.config/opencode/opencode.json`
     - `~/.dsh/profiles/desktop/package.json` and `~/.dsh/profiles/desktop/cordis.patch.yml`
     - `~/.gemini/config/config.json` (if modified)
5. **Backward Compatibility & Additive Storage**
   - Keep `packages/claude-code/**` completely untouched unless explicitly required by a shared contract fix.
   - Any SQLite schema changes MUST be strictly additive (`ALTER TABLE` / `CREATE TABLE IF NOT EXISTS`).
6. **Staged Execution with Approval Gates & Checkpoint Tags**
   - Complete one stage at a time; run `npm run check` and `npm run build`; create a checkpoint tag ONLY after verification; STOP for user review and approval before moving to the next stage.
7. **Final Merge Policy**
   - NEVER run `git reset --hard` or blindly fast-forward into the diverged local `main`.
   - Before final integration, archive the local `main` head (`archive/local-main-before-v4-<date>`), sync `main` cleanly with `origin/main`, and only then perform a clean fast-forward/merge of `feat/v4-multi-platform-plugins` after full user verification across all stages.

---

## 3. Staged Roadmap & Checkpoint Tags

| Stage | Checkpoint Tag | Scope |
|---|---|---|
| Baseline | `v4-plugins-baseline` | Clean anchor at `9c006ac` (`v3.7.0` + `opencode.md`) |
| Step 0 | `v4-step0-core` | Shared Core: Windows path normalization (`\\?\`, `file://`, trailing slash), multi-client `detect-client`, `resolveLocusHome` / `resolveRuntimeBinDir`, multi-source `runDurableExtraction`, `node:sqlite` `SQLITE_BUSY` retry, Zero-Call `Context Brief Engine` (`auto-brief.ts`), `@locus/core` library barrel, `WorkspacePool` + MCP `roots/list`, CLI `context` & `sync-runtime` commands |
| Step 1 | `v4-step1-antigravity` | Antigravity Desktop native plugin bundle (`plugin.json`, root `hooks.json`, `rules/AGENTS.md`, `skills/`, `mcp_config.json`) + `Stop` incremental `transcriptPath` ingestion + live verification |
| Step 2 | `v4-step2-codex-hooks` | Codex Desktop live hooks (`hooks.json` referenced from `.codex-plugin/plugin.json`, stable local runtime command preserving `trusted_hash`, real `SessionStart`/`UserPromptSubmit` `additionalContext`, real `Stop` rollout JSONL import) + live verification |
| Step 3 | `v4-step3-opencode` | OpenCode Desktop in-process ESM plugin (`experimental.chat.messages.transform` + `compacting` + real-time capture + `config` skills) + live verification |
| Step 4 | `v4-step4-dsh` | DeepSeek Harness Desktop in-process Cordis plugin (`cordis.patch.yml`, dynamic `ctx.systemPrompt.section`, session event capture) + live verification |
