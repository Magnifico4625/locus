# Locus x OpenCode — Integration Plan

> **Goal:** Make Locus the persistent memory platform for OpenCode with the same (or richer)
> functionality as the current Codex integration — MCP server, skill, one-command install,
> diagnostics, AND real-time passive capture via OpenCode's plugin event system.
>
> **Date:** 2026-06-17
> **Locus version:** 3.7.0
> **OpenCode target:** current (docs verified Jun 17, 2026)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [OpenCode Capabilities](#3-opencode-capabilities)
4. [Why OpenCode Is a Better Target Than Codex](#4-why-opencode-is-a-better-target-than-codex)
5. [Integration Architecture](#5-integration-architecture)
6. [File Structure](#6-file-structure)
7. [Implementation Phases](#7-implementation-phases)
8. [Key Contracts](#8-key-contracts)
9. [Storage and Client Detection](#9-storage-and-client-detection)
10. [Passive Capture via Plugin Events](#10-passive-capture-via-plugin-events)
11. [One-Command Install](#11-one-command-install)
12. [Diagnostics and Status](#12-diagnostics-and-status)
13. [Risk Assessment](#13-risk-assessment)
14. [Open Questions](#14-open-questions)
15. [Success Criteria](#15-success-criteria)

---

## 1. Executive Summary

Locus already works with OpenCode **today** as an MCP memory server — the same
`dist/server.js` that Codex uses works with OpenCode's MCP support with zero code changes.
The integration effort is about:

1. **Client-aware storage** — detect OpenCode and store memory under `~/.config/opencode/memory/`
2. **OpenCode skill** — a `SKILL.md` that OpenCode discovers via `.opencode/skills/` or `.agents/skills/`
3. **OpenCode plugin** — a JS/TS plugin that subscribes to OpenCode events for **real-time passive capture**
   (this is the big win — OpenCode has events, Codex does not)
4. **One-command install** — `locus-memory install opencode` CLI command
5. **Diagnostics** — `memory_status` and `memory_doctor` report OpenCode-specific state
6. **Docs and acceptance** — honest compatibility matrix, capture-mode guidance

**Effort estimate:**
- Phase 1 (MCP + storage + skill) ~ 1 day — "works with OpenCode"
- Phase 2 (plugin passive capture) ~ 2-3 days — "richer than Codex"
- Phase 3 (one-command install + diagnostics) ~ 1-2 days — "product-grade"
- Phase 4 (acceptance tests + docs) ~ 1 day — "honest and verified"

---

## 2. Current State Analysis

### 2.1 Codex (primary, works great)

The Codex adapter lives in `packages/codex/` and has these components:

| Component | Location | Status |
|-----------|----------|--------| 
| MCP server | `dist/server.js` | Works (17 tools, 3 resources) |
| Skill | `packages/codex/skills/locus-memory/SKILL.md` | Installed to `$CODEX_HOME/skills/` |
| Plugin bundle | `plugins/locus-memory/.codex-plugin/plugin.json` | Marketplace-ready |
| Capture/import | `packages/codex/src/` (15 files) | JSONL rollout import, capture modes |
| CLI commands | `packages/cli/src/codex/` (8 files) | install/doctor/uninstall/hook |
| Auto-import | `packages/core/src/tools/auto-import-codex.ts` | Debounced, before recall/search/calendar |
| Diagnostics | `packages/core/src/tools/codex-diagnostics.ts` | Freshness, truth, readiness |
| MCP tool | `memory_import_codex` | Manual/filtered import |

**Codex capture model:** after-the-fact JSONL import. Codex has NO hooks, so Locus reads
`~/.codex/sessions/rollout-*.jsonl` files and imports conversation events into the inbox.
Auto-import runs (debounced) before `memory_recall`, `memory_search`, `memory_calendar`.

**Capture modes:** `off` / `metadata` (default, limited) / `redacted` (recommended) / `full` (opt-in warning).

### 2.2 Claude Code (old functionality)

The Claude Code adapter lives in `packages/claude-code/hooks/`:

| Component | Location | Status |
|-----------|----------|--------|
| MCP server | `dist/server.js` (via `.mcp.json`) | Works |
| Hooks | `packages/claude-code/hooks/` (7 files) | UserPromptSubmit, Stop, PostToolUse |
| Plugin manifest | `.claude-plugin/plugin.json` | Marketplace |
| Passive capture | hooks write to inbox in real-time | Works |

**Claude Code capture model:** real-time passive capture via hooks. Three hooks fire during
a session and write `InboxEvent v1` JSON files to the project inbox:
- `UserPromptSubmit` → `user_prompt` events (redacted/full only, never metadata)
- `Stop` → `ai_response` events
- `PostToolUse` → `tool_use` events (metadata/redacted/full)

The MCP server's ingest pipeline then processes inbox files into `conversation_events`.

### 2.3 Shared Runtime

`packages/shared-runtime/` provides client-agnostic utilities:
- `detect-client.js` — detects `codex` (CODEX_HOME) / `claude-code` (CLAUDE_PLUGIN_ROOT) / `generic`
- `resolve-storage.js` — `LOCUS_STORAGE_ROOT > CODEX_HOME/memory > ~/.claude/memory > ~/.locus/memory`
- `project-hash.js`, `normalize-path.js`

**Gap:** OpenCode is not detected. It falls through to `generic` → `~/.locus/memory/`.

### 2.4 Core MCP Tools (17 total)

All clients share the same MCP server. Key tools:
- `memory_recall` — summary-first recall
- `memory_calendar` — day/week/month activity buckets
- `memory_project_state` — project identity, freshness, active next steps
- `memory_search` — FTS5 across all layers
- `memory_remember` — store decisions with auto-redaction
- `memory_import_codex` — manual Codex JSONL import (Codex-only)
- `memory_status` / `memory_doctor` — health diagnostics
- `memory_review` / `memory_audit` — inspectability

---

## 3. OpenCode Capabilities

Verified from https://opencode.ai/docs/ (Jun 17, 2026):

### 3.1 MCP Servers

OpenCode supports local and remote MCP servers via `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "locus": {
      "type": "local",
      "command": ["npx", "-y", "locus-memory", "mcp"],
      "environment": { "LOCUS_LOG": "error" },
      "enabled": true
    }
  }
}
```

- Local servers run as subprocesses (STDIO), identical launch model to Codex/Claude Code
- MCP tools auto-available to the LLM
- Per-agent MCP enable/disable via glob patterns
- Config precedence: remote → global (`~/.config/opencode/opencode.json`) → project (`opencode.json`)

### 3.2 Agent Skills

OpenCode discovers `SKILL.md` files from multiple locations:
- `.opencode/skills/<name>/SKILL.md` (project)
- `~/.config/opencode/skills/<name>/SKILL.md` (global)
- `.claude/skills/<name>/SKILL.md` (Claude-compatible!)
- `~/.claude/skills/<name>/SKILL.md` (Claude-compatible!)
- `.agents/skills/<name>/SKILL.md` (Codex-compatible!)
- `~/.agents/skills/<name>/SKILL.md` (Codex-compatible!)

**KEY INSIGHT:** OpenCode already discovers the Codex skill path (`.agents/skills/`).
So the existing Codex skill is partially discoverable by OpenCode today.

Frontmatter fields: `name` (required), `description` (required), `license`, `compatibility`, `metadata`.
Names must be lowercase alphanumeric with single hyphens, 1-64 chars, match directory name.

Skills are loaded on-demand via the native `skill` tool. Permissions configurable per-agent.

### 3.3 Plugins (THE BIG WIN)

Plugins are JS/TS modules in `.opencode/plugins/` or `~/.config/opencode/plugins/`, or from npm.

```typescript
export const LocusPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.after": async (input, output) => { /* ... */ },
    "event": async ({ event }) => { /* ... */ },
  }
}
```

**Plugin context provides:**
- `project` — current project info
- `directory` — current working directory
- `worktree` — git worktree path
- `client` — an OpenCode SDK client for interacting with the AI
- `$` — Bun shell API for executing commands

**Available events (passive capture is possible!):**

| Event | Locus equivalent | Claude Code hook |
|-------|------------------|------------------|
| `tool.execute.before` | pre-tool | — |
| `tool.execute.after` | tool_use capture | PostToolUse |
| `message.updated` | ai_response capture | Stop |
| `message.part.updated` | streaming response | — |
| `session.created` | session_start | — |
| `session.idle` | session end / response done | Stop |
| `session.compacted` | compaction | — |
| `file.edited` | file change tracking | PostToolUse (Write/Edit) |
| `tui.prompt.append` | user_prompt capture | UserPromptSubmit |
| `experimental.session.compacting` | compaction context injection | — |
| `event` | generic handler | — |

**This means OpenCode can do REAL-TIME passive capture** — like Claude Code hooks,
not after-the-fact JSONL import like Codex. This is strictly better than the Codex path.

### 3.4 Custom Tools

`.opencode/tools/*.ts` files using `tool()` helper from `@opencode-ai/plugin` with Zod schemas.
Receives context: `{ agent, sessionID, messageID, directory, worktree }`.
Could be used as an alternative to MCP, but MCP is the right path for Locus (shared server).

### 3.5 Config (`opencode.jsonc`)

Key config sections:
- `mcp` — MCP servers
- `plugin` — npm plugin packages
- `instructions` — rules files (like AGENTS.md, array of paths/globs)
- `agent` — custom agents
- `permission` — tool and skill permissions
- `compaction` — context compaction behavior

### 3.6 AGENTS.md

OpenCode's `/init` creates an `AGENTS.md` file — the same convention Codex uses.
OpenCode reads AGENTS.md for project instructions. This is already compatible with Locus's
existing AGENTS.md in this repo.

### 3.7 Config Locations

| Scope | Path |
|-------|------|
| Global config | `~/.config/opencode/opencode.json` |
| Global plugins | `~/.config/opencode/plugins/` |
| Global skills | `~/.config/opencode/skills/` |
| Global tools | `~/.config/opencode/tools/` |
| Project config | `opencode.json` (project root) |
| Project plugins | `.opencode/plugins/` |
| Project skills | `.opencode/skills/` |
| Project tools | `.opencode/tools/` |

---

## 4. Why OpenCode Is a Better Target Than Codex

| Capability | Codex | Claude Code | OpenCode |
|-----------|-------|-------------|----------|
| MCP server | Yes | Yes | Yes |
| Skill discovery | `.agents/skills/` | `.claude/skills/` | `.opencode/` + `.agents/` + `.claude/` |
| Passive event capture | **No** (JSONL import after-the-fact) | Yes (hooks) | **Yes** (plugin events) |
| Real-time capture | No | Yes | **Yes** |
| Plugin system | Experimental | `.claude-plugin/` | **Mature** (JS/TS modules, npm) |
| Custom tools | No | No | Yes |
| One-command install | `npx` + config.toml | `claude plugin install` | `npx` + opencode.json |

**Conclusion:** OpenCode combines Codex's MCP/skill model WITH Claude Code's real-time
passive capture — plus a mature plugin system. This makes OpenCode potentially the richest
Locus integration target.

---

## 5. Integration Architecture

### 5.1 Three Integration Layers

```
Layer 1: MCP Server (works today, shared with Codex/Claude)
  - dist/server.js launched via opencode.jsonc mcp.local
  - 17 tools, 3 resources, SQLite + FTS5
  - Client-aware storage after detect-client update

Layer 2: OpenCode Skill (discovery + workflow guidance)
  - packages/opencode/skills/locus-memory/SKILL.md
  - Installed to ~/.config/opencode/skills/locus-memory/
  - Tells the agent when to use memory_recall, memory_search, etc.

Layer 3: OpenCode Plugin (real-time passive capture — THE DIFFERENTIATOR)
  - packages/opencode/plugins/locus-memory.ts
  - Installed to ~/.config/opencode/plugins/locus-memory.js (compiled)
  - Subscribes to tool.execute.after, message.updated, session.idle, tui.prompt.append
  - Writes InboxEvent v1 files to the project inbox (same format as Claude Code hooks)
  - Reuses the SAME inbox → ingest → conversation_events pipeline
```

### 5.2 Data Flow

```
User prompt → tui.prompt.append event → plugin writes user_prompt InboxEvent
                                                         ↓
Agent responds → message.updated event → plugin writes ai_response InboxEvent
                                                         ↓
Tool call → tool.execute.after event → plugin writes tool_use InboxEvent
                                                         ↓
All InboxEvents land in: ~/.config/opencode/memory/locus-<hash>/inbox/
                                                         ↓
MCP server ingest pipeline processes inbox → conversation_events table
                                                         ↓
memory_recall / memory_search / memory_calendar query the stored events
```

This is the SAME data flow as Claude Code hooks, just triggered by OpenCode plugin events
instead of Claude Code hook subprocesses.

### 5.3 Reuse Strategy

| Component | Reuse from | Adaptation needed |
|-----------|-----------|-------------------|
| MCP server | `dist/server.js` | None (shared) |
| Inbox format | `InboxEvent v1` | None (shared) |
| Inbox writer | `packages/claude-code/hooks/shared.js` patterns | Extract to shared or re-implement |
| Redaction | `packages/claude-code/hooks/redact.js` / `packages/codex/src/capture.ts` | Reuse patterns |
| Storage resolution | `packages/shared-runtime/resolve-storage.js` | Add OpenCode branch |
| Client detection | `packages/shared-runtime/detect-client.js` | Add OpenCode detection |
| Capture modes | metadata/redacted/full | Same semantics |
| Skill | `packages/codex/skills/locus-memory/SKILL.md` | Adapt wording for OpenCode |
| CLI install | `packages/cli/src/codex/` pattern | Mirror for OpenCode |

---

## 6. File Structure

```
locus/
  packages/
    opencode/                    # NEW: @locus/opencode adapter
      package.json
      tsconfig.json
      README.md
      src/
        index.ts                 # Public exports
        types.ts                 # OpenCode event types, capture types
        capture.ts               # Capture mode resolution + redaction (reuse codex/claude patterns)
        inbox-event.ts           # OpenCode event → InboxEvent v1 mapping
        inbox-writer.ts          # Atomic inbox writes (reuse shared pattern)
        plugin.ts                # OpenCode plugin entry point (event subscribers)
        ids.ts                   # Deterministic event IDs
        paths.ts                 # Resolve OpenCode config/skills/plugins dirs
        skill-sync.ts            # Install skill to ~/.config/opencode/skills/
        plugin-sync.ts           # Install plugin to ~/.config/opencode/plugins/
        config-sync.ts           # Write mcp + plugin entries to opencode.json
        normalize.ts             # Normalize OpenCode event payloads
      skills/
        locus-memory/
          SKILL.md               # OpenCode-native skill
      plugins/
        locus-memory.ts          # Source for the distributed plugin
      config/
        opencode.jsonc.example   # Example config with mcp + plugin
      tests/
        capture.test.ts
        inbox-event.test.ts
        plugin.test.ts
        paths.test.ts
        skill-sync.test.ts
        config-sync.test.ts

    shared-runtime/
      detect-client.js           # MODIFY: add opencode detection
      resolve-storage.js         # MODIFY: add opencode storage branch

    cli/
      src/
        opencode/                # NEW: CLI commands for OpenCode
          commands.ts            # install/doctor/uninstall orchestration
          config.ts              # opencode.json read/write
          paths.ts               # OpenCode config dir resolution
          skill.ts               # skill install
          plugin.ts              # plugin install
          report.ts              # doctor report formatting
        commands/
          install-opencode.ts    # NEW
          doctor-opencode.ts     # NEW
          uninstall-opencode.ts  # NEW
        index.ts                 # MODIFY: add opencode subcommands

    core/
      src/
        tools/
          auto-import-opencode.ts  # NEW: auto-import coordinator (if needed)
          opencode-diagnostics.ts  # NEW: diagnostics snapshot

  dist/
    server.js                    # Shared MCP server (unchanged)
    opencode-plugin.js           # NEW: bundled plugin for distribution
```

---

## 7. Implementation Phases

### Phase 1 — "Works with OpenCode" (Target: ~1 day)

**Goal:** OpenCode users can use Locus as an MCP memory server with correct storage paths
and a discoverable skill. No passive capture yet.

**Tasks:**

- [ ] **1.1 OpenCode client detection**
  - Modify `packages/shared-runtime/detect-client.js`
  - Add `'opencode'` to `ClientEnv` union
  - Detect via env var `LOCUS_OPENCODE=1` (set in MCP config) as primary signal
  - Fallback: detect `OPENCODE_CONFIG_DIR` or `~/.config/opencode/` existence
  - Return `{ client: 'opencode', surface: 'cli'|'desktop'|'extension', detected: true, evidence: [...] }`
  - Add `LOCUS_OPENCODE_SURFACE` diagnostic override (mirror `LOCUS_CODEX_SURFACE`)

- [ ] **1.2 OpenCode storage resolution**
  - Modify `packages/shared-runtime/resolve-storage.js`
  - Add OpenCode branch: `~/.config/opencode/memory/`
  - Priority: `LOCUS_STORAGE_ROOT > OPENCODE_CONFIG_DIR/memory > CODEX_HOME/memory > ~/.claude/memory > ~/.locus/memory`
  - Add tests for OpenCode path resolution, Windows path normalization, inbox co-location

- [ ] **1.3 OpenCode skill**
  - Create `packages/opencode/skills/locus-memory/SKILL.md`
  - Adapt from Codex skill: same tool workflow (memory_recall, memory_calendar, memory_project_state, memory_search)
  - Replace Codex-specific wording (JSONL import, CODEX_HOME) with OpenCode equivalents
  - Note that passive capture is available via plugin (Phase 2)
  - Frontmatter: `name: locus-memory`, `description: ...`, `compatibility: opencode`

- [ ] **1.4 Example config**
  - Create `packages/opencode/config/opencode.jsonc.example`
  - Include `mcp.locus` entry with `npx -y locus-memory mcp` command
  - Include `LOCUS_OPENCODE=1` and `LOCUS_CAPTURE_LEVEL=redacted` env vars
  - Include `plugin` entry for the Locus plugin (Phase 2)

- [ ] **1.5 MCP server wiring**
  - Verify `dist/server.js` launches via OpenCode MCP with no code changes
  - Verify all 17 tools appear in OpenCode's tool registry
  - Verify storage lands in `~/.config/opencode/memory/locus-<hash>/`

- [ ] **1.6 Package scaffolding**
  - Create `packages/opencode/package.json` (`@locus/opencode`, private, depends on `@locus/shared-runtime`)
  - Create `packages/opencode/tsconfig.json`
  - Add to root `package.json` typecheck script

**Exit criteria:** OpenCode can launch Locus, search memory, remember decisions, load
resources, and write to an OpenCode-safe storage path. Skill is discoverable.

---

### Phase 2 — "Real-Time Passive Capture" (Target: ~2-3 days)

**Goal:** OpenCode plugin subscribes to events and writes InboxEvents in real-time —
richer than Codex's after-the-fact JSONL import, comparable to Claude Code hooks.

**Tasks:**

- [ ] **2.1 OpenCode event type definitions**
  - Create `packages/opencode/src/types.ts`
  - Define `OpenCodeToolEvent`, `OpenCodeMessageEvent`, `OpenCodeSessionEvent`, `OpenCodePromptEvent`
  - Define `OpenCodeCaptureMode` = `'off' | 'metadata' | 'redacted' | 'full'` (same as Codex)
  - Define `OpenCodeCaptureReason` (reuse Codex reasons: decision, preference, style, etc.)

- [ ] **2.2 Capture logic**
  - Create `packages/opencode/src/capture.ts`
  - `getOpenCodeCaptureMode(env)` — read `LOCUS_OPENCODE_CAPTURE` (default `metadata`)
  - `shouldCaptureOpenCodeEvent(mode, kind)` — gate by capture mode
  - `redactOpenCodeText(text)` — reuse redaction patterns from `packages/codex/src/capture.ts`
  - `captureOpenCodeEvent(event, mode)` — apply capture policy, return decision

- [ ] **2.3 InboxEvent mapping**
  - Create `packages/opencode/src/inbox-event.ts`
  - Map OpenCode events to `InboxEvent v1` with `source: 'opencode'`
  - Kinds: `user_prompt`, `ai_response`, `tool_use`, `session_start`, `session_end`
  - Reuse the `InboxEvent v1` schema from Codex/Claude adapters

- [ ] **2.4 Inbox writer**
  - Create `packages/opencode/src/inbox-writer.ts`
  - Atomic write (`.tmp` → rename) pattern, same as `packages/claude-code/hooks/shared.js`
  - Resolve inbox dir via `@locus/shared-runtime` `resolveInboxDir(projectRoot)`

- [ ] **2.5 Plugin entry point**
  - Create `packages/opencode/src/plugin.ts`
  - Export `LocusPlugin` function receiving `{ project, client, $, directory, worktree }`
  - Subscribe to events:
    - `tool.execute.after` → extract tool name, file paths, status → write `tool_use` InboxEvent
    - `message.updated` (or `session.idle`) → extract assistant response → write `ai_response` InboxEvent
    - `tui.prompt.append` → extract user prompt → write `user_prompt` InboxEvent (redacted/full only)
    - `session.created` → write `session_start` InboxEvent
  - Apply capture mode gate (metadata = no prompt/response text, only tool metadata)
  - Apply redaction before writing
  - NEVER crash — wrap all handlers in try/catch (same contract as Claude Code hooks)

- [ ] **2.6 Plugin bundling**
  - Add esbuild config to bundle `packages/opencode/src/plugin.ts` → `dist/opencode-plugin.js`
  - The bundled plugin must be a single JS file OpenCode can load from `~/.config/opencode/plugins/`
  - Include `@opencode-ai/plugin` types as dev dependency for type checking

- [ ] **2.7 Core source registration**
  - Modify `packages/core/src/types.ts`: add `'opencode'` to `source` union (`'codex' | 'claude-code' | 'opencode' | 'manual'`)
  - Verify ingest pipeline handles `source: 'opencode'` inbox events (should be source-agnostic already)

- [ ] **2.8 Capture tests**
  - Test capture mode gating (off/metadata/redacted/full)
  - Test redaction (API keys, bearer tokens, passwords)
  - Test InboxEvent mapping for each event kind
  - Test atomic inbox writes
  - Test that plugin handlers never throw

**Exit criteria:** OpenCode plugin captures tool calls, user prompts, and AI responses
in real-time, writes InboxEvents to the project inbox, and the ingest pipeline stores them
so `memory_recall` and `memory_search` return OpenCode conversation events.

---

### Phase 3 — "One-Command Install + Diagnostics" (Target: ~1-2 days)

**Goal:** `locus-memory install opencode` configures MCP, skill, and plugin in one command.
`doctor opencode` diagnoses the setup.

**Tasks:**

- [ ] **3.1 CLI scaffolding**
  - Create `packages/cli/src/opencode/` directory (mirror `packages/cli/src/codex/`)
  - `paths.ts` — resolve `~/.config/opencode/` (or `$OPENCODE_CONFIG_DIR`)
  - `config.ts` — read/write `opencode.json` (JSON, merge MCP + plugin entries)
  - `skill.ts` — copy skill to `~/.config/opencode/skills/locus-memory/SKILL.md`
  - `plugin.ts` — copy bundled plugin to `~/.config/opencode/plugins/locus-memory.js`
  - `commands.ts` — orchestrate install/doctor/uninstall
  - `report.ts` — format doctor output

- [ ] **3.2 Install command**
  - Create `packages/cli/src/commands/install-opencode.ts`
  - `locus-memory install opencode`:
    1. Resolve OpenCode config dir (`~/.config/opencode/` or `$OPENCODE_CONFIG_DIR`)
    2. Create backup of `opencode.json` if it exists
    3. Merge `mcp.locus` entry into `opencode.json` (idempotent, preserve existing config)
    4. Set MCP env: `LOCUS_OPENCODE=1`, `LOCUS_CAPTURE_LEVEL=redacted`, `LOCUS_OPENCODE_CAPTURE=redacted`
    5. Copy skill to `~/.config/opencode/skills/locus-memory/SKILL.md`
    6. Copy bundled plugin to `~/.config/opencode/plugins/locus-memory.js`
    7. Add `locus-memory` to `plugin` array in `opencode.json` (if using npm plugin) OR rely on local plugin file
    8. Acquire install lock, write cleanup marker
  - Support `--dry-run`, `--yes` flags
  - Support `LOCUS_OPENCODE_RUNTIME_PACKAGE` for pre-publish tarball smoke (mirror Codex)

- [ ] **3.3 Doctor command**
  - Create `packages/cli/src/commands/doctor-opencode.ts`
  - `locus-memory doctor opencode`:
    - Check OpenCode config dir exists and is writable
    - Check `opencode.json` has `mcp.locus` entry
    - Check MCP command resolves (`npx -y locus-memory mcp`)
    - Check skill installed at `~/.config/opencode/skills/locus-memory/SKILL.md`
    - Check plugin installed at `~/.config/opencode/plugins/locus-memory.js`
    - Check storage dir exists (`~/.config/opencode/memory/`)
    - Check capture mode (report if `metadata` = limited, recommend `redacted`)
    - Report ownership (package-owned vs legacy/manual)

- [ ] **3.4 Uninstall command**
  - Create `packages/cli/src/commands/uninstall-opencode.ts`
  - `locus-memory uninstall opencode --yes`:
    - Remove `mcp.locus` entry from `opencode.json` (preserve other config)
    - Remove `locus-memory` from `plugin` array
    - Remove skill and plugin files (only if package-owned)
    - Preserve memory data

- [ ] **3.5 CLI wiring**
  - Modify `packages/cli/src/index.ts`:
    - Add `install opencode`, `doctor opencode`, `uninstall opencode` subcommands
    - Update usage text

- [ ] **3.6 Diagnostics in MCP tools**
  - Create `packages/core/src/tools/opencode-diagnostics.ts`
  - `collectOpenCodeDiagnostics(deps)` — returns `OpenCodeDiagnosticsSnapshot | undefined`
  - Include in `memory_status`: `opencodeDiagnostics` with capture mode, plugin active, freshness
  - Include in `memory_doctor`: OpenCode-specific checks
  - Mirror the Codex diagnostics pattern (freshness, truth, readiness)

- [ ] **3.7 Auto-import coordinator (if needed)**
  - Create `packages/core/src/tools/auto-import-opencode.ts` (only if OpenCode needs after-the-fact import)
  - **Decision point:** If the plugin captures in real-time, auto-import may not be needed.
    OpenCode's plugin writes to inbox directly, so the ingest pipeline processes events
    without needing a JSONL importer. Skip this unless we add an OpenCode session-log importer.

**Exit criteria:** One command installs MCP + skill + plugin. Doctor diagnoses the full
setup. `memory_status` reports OpenCode-specific diagnostics.

---

### Phase 4 — "Acceptance, Docs, and Truth" (Target: ~1 day)

**Goal:** Honest docs, acceptance tests against real OpenCode sessions, compatibility matrix.

**Tasks:**

- [ ] **4.1 Acceptance tests**
  - Create `packages/opencode/tests/` with fixture-backed tests
  - Test that plugin events produce correct InboxEvents
  - Test that `memory_recall` returns OpenCode conversation events after plugin capture
  - Test capture modes produce the right privacy boundaries
  - Test project isolation (OpenCode memories don't leak across projects)
  - Test that `source: 'opencode'` events are searchable via `memory_search`

- [ ] **4.2 Compatibility matrix**
  - Create `docs/opencode-acceptance-matrix.md` (mirror `docs/codex-acceptance-matrix.md`)
  - Document: CLI validated, desktop/extension unverified, manual fallback, capture modes
  - Be honest about what's tested vs. assumed

- [ ] **4.3 README and docs**
  - Add OpenCode section to `README.md` Quick Start
  - Create `docs/opencode-setup.md` with install, config, and troubleshooting
  - Add OpenCode column to compatibility table
  - Update `ARCHITECTURE.md` if needed (OpenCode as a supported client)

- [ ] **4.4 Roadmap update**
  - Add OpenCode track to `docs/roadmap/codex-next.md` or create `docs/roadmap/opencode.md`
  - Position OpenCode as a primary or co-primary client alongside Codex

- [ ] **4.5 Release notes**
  - Add OpenCode integration to `docs/releases/v<next>.md`
  - Clearly separate: MCP works today, passive capture via plugin, one-command install

- [ ] **4.6 AGENTS.md consideration**
  - OpenCode reads AGENTS.md — consider whether Locus should auto-inject memory guidance
  - Likely: skill is the right path, not AGENTS.md mutation (AGENTS.md is user-owned)

**Exit criteria:** Docs match reality. Acceptance tests prove recall works with OpenCode
plugin capture. Compatibility matrix is honest.

---

## 8. Key Contracts

### Contract 1: OpenCode InboxEvent Source

```typescript
// InboxEvent v1 with OpenCode source
interface LocusInboxEventV1 {
  version: 1;
  event_id: string;          // UUID
  source: 'opencode';        // NEW source value
  source_event_id: string;   // deterministic hash
  project_root: string;
  session_id: string;        // OpenCode session ID from plugin context
  timestamp: number;         // Unix ms
  kind: 'user_prompt' | 'ai_response' | 'tool_use' | 'session_start' | 'session_end';
  payload: Record<string, unknown>;
}
```

### Contract 2: OpenCode Capture Mode Env Vars

```bash
# MCP server env (in opencode.json mcp.locus.environment)
LOCUS_OPENCODE=1                              # Primary detection signal
LOCUS_CAPTURE_LEVEL=redacted                  # Core ingest gate
LOCUS_OPENCODE_CAPTURE=redacted               # Plugin capture gate

# Diagnostic override (debug only, like LOCUS_CODEX_SURFACE)
LOCUS_OPENCODE_SURFACE=cli|desktop|extension
```

| Env var | Default | Purpose |
|---------|---------|---------|
| `LOCUS_OPENCODE` | unset | Detect OpenCode as the launching client |
| `LOCUS_OPENCODE_CAPTURE` | `metadata` | Plugin capture gate: off/metadata/redacted/full |
| `LOCUS_CAPTURE_LEVEL` | `metadata` | Core ingest second-defense gate |
| `LOCUS_OPENCODE_SURFACE` | `cli` | Diagnostic override for desktop/extension |

### Contract 3: Plugin Event → InboxEvent Mapping

| OpenCode Event | InboxEvent kind | Payload fields | Capture gate |
|----------------|-----------------|----------------|--------------|
| `tui.prompt.append` | `user_prompt` | `prompt` (redacted/full only) | metadata = skip |
| `message.updated` / `session.idle` | `ai_response` | `response`, `model` | metadata = skip |
| `tool.execute.after` | `tool_use` | `tool`, `files`, `status`, `exitCode`, `durationMs` | all modes |
| `session.created` | `session_start` | `tool`, `model` | all modes |

### Contract 4: Plugin Never Crashes

Same contract as Claude Code hooks: all plugin handlers are wrapped in try/catch.
A Locus plugin error must NEVER break OpenCode's session. Silent failure is acceptable.

### Contract 5: Storage Path Priority

```
1. $LOCUS_STORAGE_ROOT                          (explicit override, highest)
2. $OPENCODE_CONFIG_DIR/memory                  (OpenCode detected)
3. $CODEX_HOME/memory                           (Codex detected)
4. ~/.claude/memory                             (Claude Code detected)
5. ~/.locus/memory                              (generic fallback, lowest)
```

---

## 9. Storage and Client Detection

### 9.1 detect-client.js Changes

```javascript
// Add to ClientEnv union: 'claude-code' | 'codex' | 'opencode' | 'generic'

export function detectClientRuntime(env = process.env, ...) {
  // 1. OpenCode — explicit signal (set in MCP config)
  if (hasNonEmptyValue(env.LOCUS_OPENCODE)) {
    const surface = opencodeSurfaceFromEnv(env);
    return {
      client: 'opencode',
      surface,
      detected: true,
      evidence: ['env:LOCUS_OPENCODE', ...(surface !== 'cli' ? [`env:LOCUS_OPENCODE_SURFACE=${surface}`] : [])],
    };
  }

  // 2. Codex (existing)
  if (hasNonEmptyValue(env.CODEX_HOME)) { /* ... */ }

  // 3. Claude Code (existing)
  if (hasNonEmptyValue(env.CLAUDE_PLUGIN_ROOT)) { /* ... */ }

  // 4. Generic fallback
  return { client: 'generic', surface: 'generic', detected: false, evidence: ['fallback:generic'] };
}
```

### 9.2 resolve-storage.js Changes

```javascript
export function resolveStorageRoot() {
  if (process.env.LOCUS_STORAGE_ROOT) return expandTilde(process.env.LOCUS_STORAGE_ROOT);

  const client = detectClientEnv();
  const home = homedir();

  if (client === 'opencode') {
    const configDir = process.env.OPENCODE_CONFIG_DIR?.trim()
      ? expandTilde(process.env.OPENCODE_CONFIG_DIR)
      : join(home, '.config', 'opencode');
    return join(configDir, 'memory');
  }

  if (client === 'codex') return join(expandTilde(process.env.CODEX_HOME), 'memory');
  if (client === 'claude-code') return join(home, '.claude', 'memory');

  return join(home, '.locus', 'memory');
}
```

### 9.3 Why `LOCUS_OPENCODE=1` Instead of Auto-Detection?

OpenCode does not reliably set a unique env var when launching MCP servers (unlike Codex's
`CODEX_HOME`). The safest detection is an explicit env var that Locus controls in the MCP
config. This is the same approach Codex effectively uses (CODEX_HOME is set in the config).

The install command writes `LOCUS_OPENCODE=1` into the `mcp.locus.environment` block, making
detection deterministic. Manual setups must include this env var for correct storage paths.

---

## 10. Passive Capture via Plugin Events

### 10.1 Plugin Structure

```typescript
// packages/opencode/src/plugin.ts
import type { Plugin } from '@opencode-ai/plugin';
import { getOpenCodeCaptureMode } from './capture.js';
import { toOpenCodeInboxEvent } from './inbox-event.js';
import { writeOpenCodeInboxEvent } from './inbox-writer.js';
import { resolveProjectRoot } from './paths.js';

export const LocusPlugin: Plugin = async ({ project, directory, worktree }) => {
  const captureMode = getOpenCodeCaptureMode();
  if (captureMode === 'off') return {};

  const projectRoot = resolveProjectRoot(directory);

  return {
    // User prompt capture (like Claude Code UserPromptSubmit)
    'tui.prompt.append': async (input, output) => {
      try {
        const event = buildPromptEvent(input, projectRoot);
        const inboxEvent = toOpenCodeInboxEvent(event, captureMode, 'user_prompt');
        if (inboxEvent) await writeOpenCodeInboxEvent(inboxEvent);
      } catch { /* never crash */ }
    },

    // Tool use capture (like Claude Code PostToolUse)
    'tool.execute.after': async (input, output) => {
      try {
        const event = buildToolEvent(input, output, projectRoot);
        const inboxEvent = toOpenCodeInboxEvent(event, captureMode, 'tool_use');
        if (inboxEvent) await writeOpenCodeInboxEvent(inboxEvent);
      } catch { /* never crash */ }
    },

    // AI response capture (like Claude Code Stop)
    'event': async ({ event }) => {
      try {
        if (event.type === 'session.idle' || event.type === 'message.updated') {
          const aiEvent = buildAiResponseEvent(event, projectRoot);
          if (aiEvent) {
            const inboxEvent = toOpenCodeInboxEvent(aiEvent, captureMode, 'ai_response');
            if (inboxEvent) await writeOpenCodeInboxEvent(inboxEvent);
          }
        }
        if (event.type === 'session.created') {
          const sessionEvent = buildSessionStartEvent(event, projectRoot);
          const inboxEvent = toOpenCodeInboxEvent(sessionEvent, captureMode, 'session_start');
          if (inboxEvent) await writeOpenCodeInboxEvent(inboxEvent);
        }
      } catch { /* never crash */ }
    },
  };
};
```

### 10.2 Capture Mode Behavior

| Mode | user_prompt | ai_response | tool_use | session_start |
|------|-------------|-------------|----------|---------------|
| `off` | skip | skip | skip | skip |
| `metadata` (default) | skip | skip | metadata only | metadata only |
| `redacted` (recommended) | bounded + redacted | bounded + redacted | metadata + error_kind | metadata |
| `full` (opt-in warning) | full text + redacted | full text + redacted | full + bash command | full |

This matches the Codex/Claude capture mode semantics exactly.

### 10.3 What to Investigate (Open Questions)

The plugin event payload shapes need verification against a real OpenCode session:
- What fields does `tool.execute.after` provide? (tool name, args, output, error, duration?)
- What fields does `tui.prompt.append` provide? (prompt text?)
- What fields does `message.updated` / `session.idle` provide? (response text, model?)
- Does `session.idle` fire once per agent turn or once per session?

These must be verified before finalizing the inbox-event mapping in Phase 2.

---

## 11. One-Command Install

### 11.1 Install Flow

```bash
npx -y locus-memory@latest install opencode
```

Steps:
1. Resolve OpenCode config dir (`~/.config/opencode/` or `$OPENCODE_CONFIG_DIR`)
2. Backup `opencode.json` → `opencode.json.locus.bak` (if exists)
3. Merge MCP entry:
   ```jsonc
   {
     "mcp": {
       "locus": {
         "type": "local",
         "command": ["npx", "-y", "locus-memory", "mcp"],
         "environment": {
           "LOCUS_OPENCODE": "1",
           "LOCUS_CAPTURE_LEVEL": "redacted",
           "LOCUS_OPENCODE_CAPTURE": "redacted"
         },
         "enabled": true
       }
     }
   }
   ```
4. Copy skill → `~/.config/opencode/skills/locus-memory/SKILL.md`
5. Copy bundled plugin → `~/.config/opencode/plugins/locus-memory.js`
6. Write install lock / ownership marker
7. Print next steps: "Restart OpenCode, then ask for memory_status"

### 11.2 Windows Considerations

- Use `npx.cmd` on Windows (mirror Codex Windows handling)
- OpenCode on Windows recommends WSL but also supports native — test both
- Path normalization for `~/.config/opencode/` on Windows (`%USERPROFILE%\.config\opencode\`)

### 11.3 Uninstall Flow

```bash
npx -y locus-memory@latest uninstall opencode --yes
```

Removes package-owned MCP entry, plugin, and skill. Preserves memory data and user config.

---

## 12. Diagnostics and Status

### 12.1 OpenCodeDiagnosticsSnapshot

```typescript
interface OpenCodeDiagnosticsSnapshot {
  detected: boolean;
  clientSurface: 'cli' | 'desktop' | 'extension' | 'generic';
  captureMode: 'off' | 'metadata' | 'redacted' | 'full';
  pluginInstalled: boolean;
  pluginPath: string | undefined;
  skillInstalled: boolean;
  skillPath: string | undefined;
  storageDir: string;
  inboxDir: string;
  importedEventCount: number;    // from ingest_log where source='opencode'
  latestEventTimestamp: number | undefined;
  detectionEvidence: string[];
}
```

### 12.2 Status Output

`memory_status` should include (when OpenCode detected):
```
opencodeDiagnostics:
  detected: true
  surface: cli
  captureMode: redacted
  pluginInstalled: true
  skillInstalled: true
  importedEvents: 42
  latestEvent: 2026-06-17T14:32:00Z
```

### 12.3 Doctor Output

`memory_doctor` should include OpenCode checks:
- [OK] OpenCode detected via LOCUS_OPENCODE=1
- [OK] Plugin installed at ~/.config/opencode/plugins/locus-memory.js
- [OK] Skill installed at ~/.config/opencode/skills/locus-memory/SKILL.md
- [WARN] Capture mode is 'metadata' — limited recall. Switch to 'redacted' for practical recall.
- [OK] Storage at ~/.config/opencode/memory/locus-<hash>/

---

## 13. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Plugin event payload shapes differ from docs | Medium | High | Verify against real OpenCode session before finalizing mapping; keep parsers tolerant |
| OpenCode plugin API changes | Medium | Medium | Pin to stable events (`tool.execute.after`, `event`); avoid experimental events in v1 |
| OpenCode doesn't set identifying env var | High | Low | Use `LOCUS_OPENCODE=1` explicit signal in MCP config (Locus-controlled) |
| Plugin crashes OpenCode session | Low | Critical | Wrap ALL handlers in try/catch; test error paths |
| Storage path conflicts with Codex/Claude | Low | High | Explicit detection priority + `LOCUS_STORAGE_ROOT` escape hatch |
| OpenCode desktop/extension differ from CLI | Medium | Medium | Treat desktop/extension as unverified until tested; use `LOCUS_OPENCODE_SURFACE` override |
| Passive capture duplicates JSONL import | Low | Low | OpenCode uses plugin capture (real-time), not JSONL import — no duplicate path |
| Redaction misses OpenCode-specific secret shapes | Medium | Medium | Reuse Codex/Claude redaction patterns; keep best-effort, document limits |
| Windows `npx` vs `npx.cmd` | High | Medium | OS-specific command in install (mirror Codex Windows handling) |
| Plugin bundling includes too much | Low | Medium | Tree-shake via esbuild; plugin should be small (<50KB) |

---

## 14. Open Questions

1. **What exact payload do OpenCode plugin events provide?**
   - `tool.execute.after`: input/output shape? tool name field? file paths? error info? duration?
   - `tui.prompt.append`: prompt text field name? session ID?
   - `message.updated` / `session.idle`: response text? model? role?
   - **Action:** write a minimal debug plugin that logs event shapes, run it in a real OpenCode session.

2. **Does OpenCode pass session/message IDs to plugin handlers?**
   - Needed for `session_id` in InboxEvent and for deterministic `source_event_id`.
   - The plugin context has `directory` and `worktree` but session ID availability needs verification.

3. **Should the plugin be distributed as a local file or an npm package?**
   - Local file: simpler, copied by install command, no npm dependency.
   - npm package: `plugin: ["@locus/opencode-plugin"]` in config, auto-installed by Bun.
   - **Recommendation:** Start with local file (simpler, fewer moving parts). npm package as v2.

4. **Should OpenCode use auto-import (like Codex) or only plugin capture (like Claude)?**
   - Plugin capture is real-time → no JSONL import needed.
   - But if the plugin misses events (e.g., OpenCode wasn't running when capture happened),
    a session-log importer could backfill.
   - **Recommendation:** Plugin capture first. Add session-log importer only if gaps appear.

5. **Does OpenCode store session logs we could import from?**
   - Check `~/.config/opencode/` for session/history files.
   - If yes, a `memory_import_opencode` tool could mirror `memory_import_codex`.
   - **Action:** inspect OpenCode's local data directory for session artifacts.

6. **How does OpenCode handle MCP server restart / plugin reload?**
   - After install, does OpenCode need a restart to pick up new MCP + plugin?
   - Codex Desktop required a reload smoke — OpenCode may too.

7. **Should OpenCode share memory with Codex/Claude by default or stay isolated?**
   - Default: isolated (each client has its own storage dir).
   - Opt-in sharing via `LOCUS_STORAGE_ROOT` (same as current Codex/Claude model).

8. **Is `@opencode-ai/plugin` package available on npm for type definitions?**
   - Needed for TypeScript plugin development.
   - If not, use `any` types and document the expected shape.

---

## 15. Success Criteria

### Phase 1 Success
- [ ] OpenCode launches Locus MCP server via `opencode.jsonc`
- [ ] All 17 MCP tools appear in OpenCode's tool registry
- [ ] Memory stored in `~/.config/opencode/memory/locus-<hash>/` (not `~/.locus/`)
- [ ] Skill discoverable via `skill` tool in OpenCode
- [ ] `memory_status` reports `client: opencode`

### Phase 2 Success
- [ ] Plugin captures tool calls in real-time → `tool_use` InboxEvents in inbox
- [ ] Plugin captures user prompts (redacted/full) → `user_prompt` InboxEvents
- [ ] Plugin captures AI responses (redacted/full) → `ai_response` InboxEvents
- [ ] `memory_recall` returns OpenCode conversation events after a real session
- [ ] `memory_search` finds OpenCode-captured events
- [ ] Plugin never crashes OpenCode (verified error paths)
- [ ] Capture modes enforce correct privacy boundaries

### Phase 3 Success
- [ ] `locus-memory install opencode` configures MCP + skill + plugin in one command
- [ ] `locus-memory doctor opencode` diagnoses the full setup
- [ ] `locus-memory uninstall opencode --yes` cleanly removes Locus
- [ ] Install is idempotent (running twice doesn't duplicate config)
- [ ] Install preserves existing OpenCode config (merge, not replace)
- [ ] `memory_status` and `memory_doctor` report OpenCode diagnostics

### Phase 4 Success
- [ ] Docs match reality (no unverified claims)
- [ ] Acceptance tests prove recall with OpenCode plugin capture
- [ ] Compatibility matrix documents CLI vs desktop/extension status
- [ ] README Quick Start includes OpenCode
- [ ] Claude Code and Codex do not regress

---

## Appendix A: Quick Reference — Config Formats

### OpenCode (`opencode.json` or `opencode.jsonc`)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "locus": {
      "type": "local",
      "command": ["npx", "-y", "locus-memory", "mcp"],
      "environment": {
        "LOCUS_OPENCODE": "1",
        "LOCUS_LOG": "error",
        "LOCUS_CAPTURE_LEVEL": "redacted",
        "LOCUS_OPENCODE_CAPTURE": "redacted"
      },
      "enabled": true
    }
  }
}
```

### OpenCode with local plugin (after install)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "locus": {
      "type": "local",
      "command": ["npx", "-y", "locus-memory", "mcp"],
      "environment": {
        "LOCUS_OPENCODE": "1",
        "LOCUS_CAPTURE_LEVEL": "redacted",
        "LOCUS_OPENCODE_CAPTURE": "redacted"
      },
      "enabled": true
    }
  }
}
```

The plugin is loaded automatically from `~/.config/opencode/plugins/locus-memory.js` —
no config entry needed for local plugin files.

### OpenCode with npm plugin (alternative, v2)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { /* ... */ },
  "plugin": ["@locus/opencode-plugin"]
}
```

---

## Appendix B: Locus MCP Surface (what OpenCode gets)

### 17 Tools (shared with Codex/Claude)

| # | Tool | Description |
|---|------|-------------|
| 1 | `memory_explore` | Navigate project structure by path |
| 2 | `memory_search` | FTS5 search across all layers + conversation events |
| 3 | `memory_remember` | Store a decision with auto-redaction + optional tags |
| 4 | `memory_forget` | Delete matching memories (two-call confirmation) |
| 5 | `memory_scan` | Re-index project structure |
| 6 | `memory_status` | Storage stats, backend info, project identity, client diagnostics |
| 7 | `memory_doctor` | Health diagnostic |
| 8 | `memory_audit` | Security audit |
| 9 | `memory_purge` | Full database reset (two-call confirmation) |
| 10 | `memory_config` | Show active configuration and env overrides |
| 11 | `memory_compact` | Clean old episodic entries |
| 12 | `memory_timeline` | Chronological conversation event viewer |
| 13 | `memory_recall` | Summary-first recall |
| 14 | `memory_calendar` | Day/week/month activity buckets |
| 15 | `memory_project_state` | Project identity, freshness, active next steps |
| 16 | `memory_review` | Inspect durable memories, states, confidence, evidence |
| 17 | `memory_import_codex` | Manual Codex JSONL import (Codex-only, not for OpenCode) |

### 3 Resources (auto-injected in Claude Code, loaded on demand in OpenCode)

| Resource | URI | Token Budget |
|----------|-----|-------------|
| Project Map | `memory://project-map` | < 2,000 tokens |
| Decisions | `memory://decisions` | < 500 tokens |
| Recent Activity | `memory://recent` | < 1,000 tokens |

---

## Appendix C: Comparison — Codex vs OpenCode Adapter

| Aspect | Codex adapter | OpenCode adapter (planned) |
|--------|--------------|---------------------------|
| MCP config | `~/.codex/config.toml` (TOML) | `opencode.json` (JSON) |
| MCP entry | `[mcp_servers.locus]` | `mcp.locus` |
| Skill location | `$CODEX_HOME/skills/` | `~/.config/opencode/skills/` |
| Skill discovery | `.agents/skills/` | `.opencode/` + `.agents/` + `.claude/` |
| Passive capture | JSONL import (after-the-fact) | Plugin events (real-time) |
| Capture source | `~/.codex/sessions/rollout-*.jsonl` | Plugin event handlers |
| Auto-import | Yes (debounced, before recall) | Not needed (real-time capture) |
| Plugin system | Experimental | Mature (JS/TS modules) |
| Install command | `locus-memory install codex` | `locus-memory install opencode` |
| Doctor command | `locus-memory doctor codex` | `locus-memory doctor opencode` |
| Detection env | `CODEX_HOME` | `LOCUS_OPENCODE=1` |
| Storage | `$CODEX_HOME/memory/` | `~/.config/opencode/memory/` |
| Capture env | `LOCUS_CODEX_CAPTURE` | `LOCUS_OPENCODE_CAPTURE` |
| Surface override | `LOCUS_CODEX_SURFACE` | `LOCUS_OPENCODE_SURFACE` |

---

*This document is a living plan. Update as OpenCode's plugin API evolves and integration
progresses. Verify all event payload shapes against a real OpenCode session before
finalizing Phase 2.*
