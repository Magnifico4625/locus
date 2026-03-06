# Locus x Codex CLI — Multi-Platform Integration Plan

> **Goal:** Make Locus the first serious persistent memory solution that works seamlessly across
> **Claude Code** and **OpenAI Codex CLI** — positioning it as a truly client-agnostic memory framework.

**Date:** 2026-03-06
**Locus version:** 3.0.5
**Codex CLI version:** 0.111.0 (latest as of writing)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Codex CLI Architecture Overview](#2-codex-cli-architecture-overview)
3. [Compatibility Matrix](#3-compatibility-matrix)
4. [Integration Layers](#4-integration-layers)
   - 4.1 [MCP Server (works today)](#41-mcp-server-works-today)
   - 4.2 [Codex Skill](#42-codex-skill)
   - 4.3 [Codex Plugin (marketplace)](#43-codex-plugin-marketplace)
   - 4.4 [AGENTS.md Integration](#44-agentsmd-integration)
5. [What Needs to Change in Locus](#5-what-needs-to-change-in-locus)
6. [Hardcoded `~/.claude/` Paths — Migration Plan](#6-hardcoded-claude-paths--migration-plan)
7. [Hooks Adaptation](#7-hooks-adaptation)
8. [npm Package Strategy](#8-npm-package-strategy)
9. [Competitive Landscape](#9-competitive-landscape)
10. [Implementation Phases](#10-implementation-phases)
11. [File Structure After Integration](#11-file-structure-after-integration)
12. [Risk Assessment](#12-risk-assessment)
13. [Open Questions](#13-open-questions)

---

## 1. Executive Summary

Locus is already built on the Model Context Protocol (MCP) — the same protocol that Codex CLI
natively supports. The MCP server (`dist/server.js`) works with Codex **today** with zero code
changes. The integration effort is primarily about:

1. **Removing hardcoded `~/.claude/` paths** — making storage location client-aware
2. **Publishing an npm package** — enabling `npx` one-liner installs
3. **Creating Codex-native artifacts** — SKILL.md, AGENTS.md guidance, config.toml examples
4. **Adapting event capture** — Codex has no hook system like Claude Code; need alternative adapters

**Effort estimate:** Phase 1 (MCP + docs) ~ 1 day. Phase 2 (full integration) ~ 3-5 days.

---

## 2. Codex CLI Architecture Overview

### Extension Mechanisms

Codex CLI (v0.111.0) provides four extension mechanisms:

| Mechanism | Format | Discovery Path | Analogy in Claude Code |
|-----------|--------|---------------|------------------------|
| **MCP Servers** | `config.toml` TOML tables | `~/.codex/config.toml` or `.codex/config.toml` | `.mcp.json` |
| **Skills** | `SKILL.md` + optional scripts | `$CWD/.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills` | `.claude/skills/` |
| **Plugins** | `marketplace.json` (new v0.110.0) | Local marketplace + install endpoint | `.claude-plugin/` |
| **AGENTS.md** | Markdown instructions | Git root → cwd, `~/.codex/AGENTS.md` | `CLAUDE.md` |

### MCP in Codex

Codex supports MCP servers via `config.toml`:

```toml
# ~/.codex/config.toml — STDIO server (our case)
[mcp_servers.locus]
command = "node"
args = ["/path/to/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"

# Alternative: npx (preferred for distribution)
[mcp_servers.locus]
command = "npx"
args = ["-y", "@locus-memory/mcp-server"]
```

**Key differences from Claude Code's `.mcp.json`:**
- TOML format (not JSON)
- Flat `[mcp_servers.<name>]` tables (not nested `mcpServers` wrapper)
- Supports `enabled`, `required`, `enabled_tools`, `disabled_tools` fields
- Supports `startup_timeout_sec` and `tool_timeout_sec`
- Shared between CLI and VS Code extension automatically

### Codex Skills Format

```
my-skill/
  SKILL.md          # Required — YAML frontmatter + instructions
  scripts/          # Optional — helper scripts
  references/       # Optional — reference docs
  assets/           # Optional — icons, images
  agents/openai.yaml  # Optional — UI/behavior config + MCP dependencies
```

**SKILL.md frontmatter:**
```yaml
---
name: skill-name
description: When this skill should and should not trigger.
---

Instructions for the agent to follow.
```

**agents/openai.yaml** (optional but powerful):
```yaml
interface:
  display_name: "Locus Memory"
  short_description: "Persistent project memory"
  icon_small: "./assets/icon.svg"
  brand_color: "#6B5CE7"

policy:
  allow_implicit_invocation: true  # Codex can auto-select this skill

dependencies:
  tools:
    - type: "mcp"
      value: "memory_search"
      description: "Search project memory"
      transport: "stdio"
```

**Discovery priority:** REPO (.agents/skills) > USER (~/.agents/skills) > ADMIN (/etc/codex/skills) > SYSTEM (built-in)

### Codex Built-in Memory

Codex v0.107.0+ has a built-in memory system:
- Diff-based forgetting and usage-aware selection
- Workspace-scoped writes with stale-fact guardrails
- Slash commands: `/m_update`, `/m_drop`
- `codex debug clear-memories` to reset

**Assessment:** Primitive compared to Locus — no structural map, no FTS5, no conversation event log,
no semantic/episodic layers, no security audit trail. Locus provides a fundamentally richer memory model.

---

## 3. Compatibility Matrix

### Current State (v3.0.5)

| Component | Claude Code | Codex CLI | Cursor/Windsurf/Cline |
|-----------|-------------|-----------|----------------------|
| MCP Server (12 tools) | Full | **Works today** | Full |
| MCP Resources (3) | Auto-injected | **Works today** | Manual |
| Skills (8) | Claude skill format | **Needs adaptation** | N/A |
| Hooks (3: UserPromptSubmit, Stop, PostToolUse) | Full | **No equivalent** | N/A |
| Plugin manifest | `.claude-plugin/plugin.json` | **Needs new manifest** | N/A |
| Storage path | `~/.claude/memory/locus-<hash>/` | **Needs `~/.codex/` support** | Configurable |
| Inbox path | `~/.claude/memory/locus-<hash>/inbox/` | **Needs adaptation** | N/A |

### Target State (v3.2)

| Component | Claude Code | Codex CLI | Cursor/Windsurf/Cline |
|-----------|-------------|-----------|----------------------|
| MCP Server (12 tools) | Full | Full | Full |
| MCP Resources (3) | Auto-injected | Auto-loaded | Manual |
| Skills | Claude format | Codex SKILL.md format | N/A |
| Event capture | Hooks (native) | Adapter (log-tailer or MCP events) | Adapter (log-tailer) |
| Plugin manifest | `.claude-plugin/` | `.agents/skills/` + config.toml | N/A |
| Storage path | Client-detected | Client-detected | Client-detected |

---

## 4. Integration Layers

### 4.1 MCP Server (works today)

**Zero code changes needed.** Our `dist/server.js` is a standard MCP STDIO server using
`@modelcontextprotocol/sdk`. Codex CLI launches STDIO MCP servers identically to Claude Code.

**User setup (manual):**
```bash
# Option A: CLI command
codex mcp add locus -- node /path/to/locus/dist/server.js

# Option B: Direct config edit
# Add to ~/.codex/config.toml:
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
```

**User setup (npx — after npm publish):**
```bash
codex mcp add locus -- npx -y @locus-memory/mcp-server
```

**What works immediately:**
- All 12 MCP tools (memory_search, memory_remember, memory_explore, etc.)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage, FTS5 search, semantic + episodic memory

**What does NOT work:**
- Passive event capture (no hooks in Codex)
- Storage goes to `~/.claude/memory/` (wrong path for Codex users)
- Skills are in Claude format (not Codex SKILL.md)

### 4.2 Codex Skill

Create a Locus skill package that Codex can discover and load:

```
.agents/skills/locus-memory/
  SKILL.md
  agents/openai.yaml
  assets/
    icon.svg
```

**SKILL.md content:**
```yaml
---
name: locus-memory
description: >
  Use when the user needs persistent project memory across sessions.
  Triggers on: "remember this", "what did we decide about...",
  "show project structure", "what changed recently", "search memory".
  Do NOT trigger for: ephemeral questions, one-off lookups,
  file reads that don't need memory.
---

# Locus — Persistent Project Memory

You have access to Locus memory tools via MCP. Use them to:

1. **Search memory** — `memory_search` for decisions, code patterns, past events
2. **Remember decisions** — `memory_remember` to save architecture choices with tags
3. **Explore structure** — `memory_explore` to navigate the project file tree
4. **View timeline** — `memory_timeline` for recent conversation history
5. **Check status** — `memory_status` for memory health and storage info

## Key Behaviors
- Always search memory before re-asking questions the user already answered
- Save important decisions automatically when the user makes architecture choices
- Use `memory_scan` after significant file structure changes
- Prefer `memory_search` over re-reading files when looking for past context
```

**agents/openai.yaml:**
```yaml
interface:
  display_name: "Locus Memory"
  short_description: "Persistent project memory — structural map, decisions, session history"
  brand_color: "#6B5CE7"
  default_prompt: "Search project memory for relevant context before starting work."

policy:
  allow_implicit_invocation: true

dependencies:
  tools:
    - type: "mcp"
      value: "memory_search"
      description: "Full-text search across all memory layers"
    - type: "mcp"
      value: "memory_remember"
      description: "Store a decision with auto-redaction"
    - type: "mcp"
      value: "memory_explore"
      description: "Navigate project file structure"
    - type: "mcp"
      value: "memory_status"
      description: "Memory health and storage info"
    - type: "mcp"
      value: "memory_scan"
      description: "Re-index project structure"
    - type: "mcp"
      value: "memory_timeline"
      description: "View recent conversation events"
```

### 4.3 Codex Plugin (marketplace)

The plugin system (v0.110.0, released 2026-03-05) is brand new. It loads skills + MCP entries +
app connectors from a local `marketplace.json`. The format is still stabilizing, but the basic
structure is:

```json
{
  "plugins": [
    {
      "name": "locus-memory",
      "source": {
        "source": "local",
        "path": "./locus-memory"
      }
    }
  ]
}
```

**Recommendation:** Wait for the plugin format to stabilize (likely 1-2 months) before investing
in a full Codex plugin manifest. The MCP server + Skill approach covers 95% of functionality.

### 4.4 AGENTS.md Integration

Locus can generate content optimized for AGENTS.md consumption. Our MCP resources already produce
structured text:

- `locus://project-map` → structural file map (perfect for AGENTS.md preamble)
- `locus://decisions` → saved architecture decisions
- `locus://recent` → recent session summary

**Potential feature:** A `memory_agents_md` tool that outputs a combined context block
suitable for pasting into AGENTS.md, or a `--agents-md` CLI flag that generates/updates the file.

---

## 5. What Needs to Change in Locus

### 5.1 Critical Changes (Phase 1)

| Change | Files Affected | Effort |
|--------|---------------|--------|
| Client-aware storage path | `server.ts` (line 64-67) | Small |
| npm package for `npx` distribution | `package.json`, new entry point | Medium |
| README: Codex CLI setup section | `README.md` | Small |
| Codex skill files | New: `.agents/skills/locus-memory/` | Small |

### 5.2 Medium-term Changes (Phase 2)

| Change | Files Affected | Effort |
|--------|---------------|--------|
| Codex event capture adapter | New: `packages/codex/` | Large |
| Unified config detection | `server.ts`, new `detect-client.ts` | Medium |
| Codex-compatible skill format | New skill files alongside Claude skills | Small |
| Cross-client test suite | New test files | Medium |

---

## 6. Hardcoded `~/.claude/` Paths — Migration Plan

### Current State

In `server.ts:64-67`:
```typescript
const dbPath = options?.dbPath ??
  join(homedir(), '.claude', 'memory', `locus-${projectHash(root)}`, 'locus.db');
const logPath = join(homedir(), '.claude', 'memory', 'locus.log');
```

Storage is hardcoded to `~/.claude/memory/`. This is wrong for Codex users.

### Proposed Solution: Client-Aware Path Resolution

```typescript
function resolveStorageRoot(): string {
  // 1. Explicit override (highest priority)
  if (process.env.LOCUS_STORAGE_ROOT) {
    return process.env.LOCUS_STORAGE_ROOT;
  }

  // 2. Detect client from environment
  const home = homedir();

  // Codex sets CODEX_HOME or runs from ~/.codex/
  if (process.env.CODEX_HOME) {
    return join(process.env.CODEX_HOME, 'memory');
  }

  // Claude Code uses ~/.claude/ (CLAUDE_PLUGIN_ROOT is set for plugins)
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return join(home, '.claude', 'memory');
  }

  // 3. Default: use ~/.locus/ (client-agnostic)
  return join(home, '.locus', 'memory');
}
```

**Storage hierarchy:**
| Priority | Signal | Path |
|----------|--------|------|
| 1 | `$LOCUS_STORAGE_ROOT` | Explicit user override |
| 2 | `$CODEX_HOME` | `$CODEX_HOME/memory/locus-<hash>/` |
| 3 | `$CLAUDE_PLUGIN_ROOT` | `~/.claude/memory/locus-<hash>/` |
| 4 | Default | `~/.locus/memory/locus-<hash>/` |

**Backward compatibility:** Existing Claude Code users keep their data in `~/.claude/memory/`.
The `CLAUDE_PLUGIN_ROOT` detection ensures zero migration needed.

**Shared memory across clients:** If a user wants Claude Code and Codex to share the same
memory database, they set `LOCUS_STORAGE_ROOT` to the same path in both configurations.

### Inbox Path

Same logic applies to `inboxDir` (line 73):
```typescript
const inboxDir = join(dirname(dbPath), 'inbox');
```
This is already relative to `dbPath`, so fixing `dbPath` resolution fixes inbox too.

---

## 7. Hooks Adaptation

### The Problem

Locus v3.0 uses three Claude Code hooks for passive event capture:

| Hook | Captures | File |
|------|----------|------|
| `UserPromptSubmit` | User prompts → inbox | `user-prompt.js` |
| `Stop` | AI response transcripts → inbox | `stop.js` |
| `PostToolUse` | File diffs, tool metadata → inbox | `post-tool-use.js` |

Codex CLI has **no hook system**. It has:
- **Slash commands** — user-initiated (not automatic)
- **MCP tool calls** — model-initiated (tools can't passively observe)
- **App Server protocol** — bidirectional Items/Turns/Threads, but not exposed for plugins

### Options for Codex Event Capture

| Approach | Feasibility | Notes |
|----------|-------------|-------|
| **A. MCP-native events** | Future | MCP spec may add event subscriptions; not available today |
| **B. Codex App Server API** | Medium | Turns/Threads are structured; need API access for plugins |
| **C. Log file tailer** | Proven | Watch Codex output/history files; same approach as `@locus/log-tailer` |
| **D. Explicit MCP tool** | Easy | `memory_capture` tool the model calls to log events explicitly |
| **E. AGENTS.md instructions** | Easy | Instruct Codex to call `memory_remember` after key decisions |

### Recommended Approach

**Phase 1 (immediate):** Approach **D + E** — add instructions in the Codex skill that tell the
model to actively call `memory_remember` after architecture decisions and use `memory_search`
before starting work. This is zero-infrastructure and works today.

**Phase 2 (v3.2):** Approach **C** — implement `@locus/log-tailer` that watches Codex's
SQLite state database (`$CODEX_HOME/state.db` or similar) for new conversation entries.

**Phase 3 (v4.0+):** Approach **A/B** — as MCP and Codex App Server mature, switch to
native event subscriptions for real-time passive capture.

---

## 8. npm Package Strategy

### Current State

Locus is distributed as:
1. **Claude Code plugin** — `claude plugin install locus` (from marketplace repo)
2. **Local clone** — `git clone` + `node dist/server.js`

Neither works well for Codex CLI's `codex mcp add` workflow.

### Proposed: Publish `@locus-memory/mcp-server` to npm

**Entry point:** A thin wrapper that bootstraps the server:

```typescript
// packages/npm/bin/locus-server.ts
#!/usr/bin/env node
import { createServer } from '@locus/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const ctx = await createServer();
const transport = new StdioServerTransport();
await ctx.server.connect(transport);
```

**package.json:**
```json
{
  "name": "@locus-memory/mcp-server",
  "version": "3.1.0",
  "bin": { "locus-server": "./bin/locus-server.js" },
  "engines": { "node": ">=22.0.0" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^3.x"
  }
}
```

**Installation across all clients:**
```bash
# Codex CLI
codex mcp add locus -- npx -y @locus-memory/mcp-server

# Claude Code (.mcp.json)
{ "locus": { "command": "npx", "args": ["-y", "@locus-memory/mcp-server"] } }

# Cursor (.cursor/mcp.json)
{ "mcpServers": { "locus": { "command": "npx", "args": ["-y", "@locus-memory/mcp-server"] } } }
```

**One command, every client.** This is the single biggest distribution improvement we can make.

---

## 9. Competitive Landscape

### Memory Solutions in Codex Ecosystem

| Solution | Type | Pricing | Storage | Layers |
|----------|------|---------|---------|--------|
| **Codex built-in** | Native | Free | Local sqlite | Single (flat memories) |
| **BasicMemory** | MCP (cloud) | Paid SaaS | Cloud | Notes + search |
| **memories.sh** | MCP | Free? | Unknown | Unknown |
| **Locus (ours)** | MCP (local) | Free, MIT | Local sqlite | 3 layers + FTS5 + audit |

### Locus Competitive Advantages

1. **Local-first, zero-cost** — no API keys, no cloud, no subscription
2. **3 memory layers** — structural + semantic + episodic vs flat key-value
3. **FTS5 full-text search** — ranked BM25 scoring across all layers
4. **Security-first** — 4-layer security with auto-redaction and audit trail
5. **Project-aware** — auto-detects project root, computes structural map
6. **819 tests** — most thoroughly tested memory solution available
7. **Multi-client** — works with Claude Code, Codex, Cursor, Windsurf, Cline, Zed
8. **Zero native deps** — Node 22+ built-in sqlite, sql.js fallback

### Positioning

> "Locus is the open-source, local-first persistent memory framework for AI coding tools.
> One MCP server. Every client. Your data stays on your machine."

---

## 10. Implementation Phases

### Phase 1 — "Works with Codex" (Target: v3.1.0, ~1 day)

- [ ] **Client-aware storage path** — `resolveStorageRoot()` with env detection
- [ ] **README update** — add "Codex CLI" to Quick Start with `config.toml` example
- [ ] **Codex skill** — `.agents/skills/locus-memory/SKILL.md` + `agents/openai.yaml`
- [ ] **Compatibility table update** — add Codex CLI column
- [ ] **Test** — verify `dist/server.js` launches via `codex mcp add`

### Phase 2 — "npm Package" (Target: v3.1.x, ~1-2 days)

- [ ] **Create `@locus-memory/mcp-server` package** — thin npx-able wrapper
- [ ] **Publish to npm** — automated via GitHub Actions
- [ ] **Update all docs** — npx command in README, marketplace, etc.
- [ ] **One-liner install** for Claude Code, Codex, Cursor, Windsurf

### Phase 3 — "Full Codex Integration" (Target: v3.2.0, ~3-5 days)

- [ ] **`packages/codex/`** — Codex-specific adapter package
- [ ] **Log tailer adapter** — watch Codex state for conversation events
- [ ] **AGENTS.md generator** — `memory_agents_md` tool or CLI flag
- [ ] **Codex plugin manifest** — when marketplace format stabilizes
- [ ] **Cross-client E2E tests** — verify both Claude Code and Codex workflows

### Phase 4 — "Universal Memory" (Target: v4.0, future)

- [ ] **MCP event subscriptions** — passive capture via protocol (when available)
- [ ] **Adapter registry** — pluggable client detection + event capture
- [ ] **Shared memory** — optional cross-project memory graph
- [ ] **Dashboard** — HTML UI for memory visualization (works in any browser)

---

## 11. File Structure After Integration

```
locus/
  .claude-plugin/         # Claude Code plugin manifest
    plugin.json
  .mcp.json               # Claude Code MCP config

  packages/
    core/                  # @locus/core — shared MCP server + memory engine
      src/
        server.ts          # Client-aware storage path (CHANGED)
        detect-client.ts   # NEW: client environment detection
        ...
    claude-code/           # @locus/claude-code — hooks for Claude Code
      hooks/
        user-prompt.js
        stop.js
        post-tool-use.js
    codex/                 # NEW: @locus/codex — Codex-specific adapter
      skills/
        locus-memory/
          SKILL.md
          agents/openai.yaml
          assets/icon.svg
      config/
        config.toml.example

  skills/                  # Claude Code skills (existing)
    remember/SKILL.md
    forget/SKILL.md
    ...

  dist/
    server.js              # Bundled MCP server (universal)
```

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Codex plugin format changes | High | Medium | Start with MCP + Skill, defer plugin manifest |
| Storage path conflicts | Low | High | `$LOCUS_STORAGE_ROOT` escape hatch + clear detection |
| Node 22 not available in Codex env | Low | Critical | Test; sql.js fallback covers older Node |
| Codex drops MCP support | Very Low | Critical | MCP is industry standard; unlikely |
| BasicMemory gets deeper Codex integration | Medium | Medium | Ship fast; our local-first angle is unique |
| Codex users don't find Locus | Medium | High | npm package + Codex skill marketplace listing |

---

## 13. Open Questions

1. **Does Codex set any identifying environment variable?** Need to test — `CODEX_HOME`,
   `CODEX_SESSION`, or similar. This determines how `resolveStorageRoot()` detects the client.

2. **Can Codex skills declare MCP dependencies that auto-install?** The `agents/openai.yaml`
   `dependencies.tools` field suggests yes, but unclear if it auto-configures `config.toml`.

3. **Does Codex expose conversation history via files or API?** If yes, `@locus/log-tailer`
   can passively capture events without hooks. Check `$CODEX_HOME/state.db`.

4. **npm org name availability:** Is `@locus-memory` available on npm? Alternatives:
   `@locus-ai`, `@locus-mcp`, `locus-memory-server`.

5. **Shared memory opt-in:** Should Claude Code and Codex share the same DB by default, or
   require explicit `LOCUS_STORAGE_ROOT`? Default to separate (safer) — users opt in to share.

6. **Codex plugin marketplace:** Is there an official directory/registry for plugins?
   If so, submit Locus for listing alongside the Claude Code marketplace.

---

## Appendix A: Quick Reference — Config Formats

### Claude Code (.mcp.json — flat plugin format)
```json
{
  "locus": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/dist/server.js"],
    "env": { "LOCUS_LOG": "error" }
  }
}
```

### Codex CLI (config.toml)
```toml
[mcp_servers.locus]
command = "npx"
args = ["-y", "@locus-memory/mcp-server"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
```

### Cursor (.cursor/mcp.json — nested format)
```json
{
  "mcpServers": {
    "locus": {
      "command": "npx",
      "args": ["-y", "@locus-memory/mcp-server"],
      "env": { "LOCUS_LOG": "error" }
    }
  }
}
```

### Claude Desktop (claude_desktop_config.json — nested format)
```json
{
  "mcpServers": {
    "locus": {
      "command": "npx",
      "args": ["-y", "@locus-memory/mcp-server"],
      "env": { "LOCUS_LOG": "error" }
    }
  }
}
```

## Appendix B: Locus MCP Surface (what Codex gets)

### 12 Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | `memory_explore` | Navigate project structure by path |
| 2 | `memory_search` | FTS5 search across all layers + conversation events |
| 3 | `memory_remember` | Store a decision with auto-redaction + optional tags |
| 4 | `memory_forget` | Delete matching memories (two-call confirmation) |
| 5 | `memory_scan` | Re-index project structure (git-diff → mtime → full) |
| 6 | `memory_status` | Storage stats, backend info, project identity |
| 7 | `memory_doctor` | 12-point health diagnostic |
| 8 | `memory_audit` | Security audit — what's stored, redaction status, FTS5 health |
| 9 | `memory_purge` | Full database reset (two-call confirmation) |
| 10 | `memory_config` | Show active configuration and env overrides |
| 11 | `memory_compact` | Clean old episodic entries (configurable age + keep count) |
| 12 | `memory_timeline` | Chronological conversation event viewer with filters |

### 3 Resources (auto-injected in Claude Code, loaded on demand in Codex)

| Resource | URI | Token Budget |
|----------|-----|-------------|
| Project Map | `memory://project-map` | < 2,000 tokens |
| Decisions | `memory://decisions` | < 500 tokens |
| Recent Activity | `memory://recent` | < 1,000 tokens |

---

*This document is a living plan. Update as Codex CLI evolves and integration progresses.*

---

## Appendix C: Review Addendum — Codex Readiness (added by Codex)

**Reviewer:** Codex
**Review date:** 2026-03-06

### Overall assessment

The plan is **directionally correct** and the project **can work as persistent memory for Codex**
if implemented, but with one important clarification:

- **Yes** — it can work **today** as an MCP-based project memory layer (search, remember, scan,
  resources, project map, decisions).
- **Not yet fully** — it will **not** behave like Claude Code Carbon Copy out of the box, because
  Codex does not give you Claude-style hooks. Passive capture needs a Codex-specific adapter.

So the correct framing is:

> **Phase 1 gives Codex explicit persistent memory.**
> **Phase 2/3 gives Codex passive or semi-passive memory capture.**

That distinction is critical and should be explicit in positioning and release notes.

### What I verified locally in this project

- `codex-cli 0.111.0` is installed locally.
- `codex mcp` exists and is usable from CLI.
- Codex has a real local home at `~/.codex/` with `config.toml`, `skills`, `memories`,
  `sessions`, and `state_5.sqlite`.
- The current Locus codebase is healthy at baseline:
  - `npm run typecheck` passed
  - `npm test` passed
  - Result: **819 tests passed**
- Current hardcoded Claude storage paths exist in code today:
  - `packages/core/src/server.ts`
  - `packages/claude-code/hooks/shared.js`

### Corrections to the current plan

#### 1. Storage migration affects more than `server.ts`

This is the biggest implementation gap in the plan.

The migration is **not only** `server.ts:64-67`.
It also affects:

- `packages/claude-code/hooks/shared.js`
- tests that assert `~/.claude/memory/...`
- README / ARCHITECTURE examples
- any health/audit/status output that prints paths

**Recommendation:** introduce one shared path resolver contract and test it directly.
Do not duplicate Codex/Claude path logic in multiple places.

#### 2. `state.db` is probably the wrong primary capture target for Codex

Local inspection shows that Codex keeps:

- `~/.codex/state_5.sqlite`
- `~/.codex/sessions/YYYY/MM/DD/rollout-...jsonl`

From the local schema, `state_5.sqlite` appears to contain mostly thread metadata/log tables.
The richer conversation/event stream is referenced via `threads.rollout_path` and stored in
session JSONL files.

**Better Phase 2 target:** tail or import from `~/.codex/sessions/...jsonl`, not primarily from
`state_5.sqlite`.

That gives you a more realistic path to passive capture.

#### 3. Codex plugin / marketplace should be treated as speculative, not near-term

Local `codex features list` shows:

- `plugins` = under development
- `apps` = experimental

So the current plugin section is too optimistic for a near-term delivery target.

**Recommendation:** re-scope plugin work as:

- optional research track
- not in core delivery path
- not part of success criteria for v3.1 / v3.2

The MCP + skill + docs path is the real product path right now.

#### 4. Built-in Codex memory claims should be downgraded to "unverified / optional"

In the locally installed Codex, memory-related feature flags are not presented as a stable public
surface, and `codex debug` does not expose the memory commands listed in this document.

So statements about:

- slash commands like `/m_update`, `/m_drop`
- `codex debug clear-memories`

should be marked as **unverified for the target version/environment** unless re-checked at release
time.

#### 5. Windows setup needs explicit examples

In local Codex config on Windows, MCP commands commonly use `npx.cmd`, not `npx`.

So the docs should include OS-specific examples:

- Windows: `npx.cmd`
- macOS/Linux: `npx`

Without this, users will hit avoidable launch failures.

#### 6. "Works today" needs a narrower definition

The phrase "works today" is true only for the MCP memory layer.
It is **not** true for passive conversation capture.

Use wording like:

> "Locus works in Codex today as an MCP memory server. Automatic conversation capture requires a
> Codex adapter and is not part of the current shipping path."

That keeps expectations accurate.

### Additional implementation requirements I recommend adding

#### A. Add a dedicated "client detection and storage contract" section

Add explicit rules:

1. `LOCUS_STORAGE_ROOT` overrides everything
2. explicit `dbPath` overrides resolver logic
3. Codex uses `CODEX_HOME` when present
4. Claude plugin mode uses `CLAUDE_PLUGIN_ROOT`
5. fallback is client-agnostic `~/.locus/memory`

Also add tests for:

- Codex path resolution
- Claude path resolution
- explicit override precedence
- Windows path normalization
- inbox/log co-location guarantees

#### B. Add a dedicated "Codex event adapter contract"

Define what a Codex adapter must do before implementation:

- source of truth: session rollout JSONL
- poll or tail strategy
- dedup key derivation
- mapping from Codex event types to Locus event schema
- privacy/redaction boundary before storage
- failure behavior when session format changes

Without this contract, Phase 3 can drift.

#### C. Add a minimal Phase 1.5 for "active memory discipline"

Before passive capture, create a small Codex-native workflow:

- Skill instructions: search memory before work
- Skill instructions: call `memory_remember` after important decisions
- AGENTS.md snippet for teams that want stricter behavior
- maybe a tiny helper command or prompt template for "commit decision to memory"

This gives useful behavior immediately, even before adapters exist.

#### D. Add compatibility tests against real Codex file layout assumptions

At minimum, add fixtures/tests for:

- `.codex/config.toml` examples
- `~/.codex/sessions/...jsonl` parsing
- absence of hooks
- empty session history
- changed session schema fallback behavior

#### E. Add release criteria per phase

Current phases are good, but they need hard exit criteria.

Suggested examples:

- **Phase 1 complete when:** Codex can launch Locus, search memory, remember decisions, load
  resources, and write to a Codex-safe storage path.
- **Phase 2 complete when:** `npx` install works on Windows and POSIX, docs are tested, and a clean
  machine setup path is verified.
- **Phase 3 complete when:** conversation events from Codex sessions are ingested with dedup,
  redaction, and regression tests.

### Additional risks to add

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Codex session JSONL schema changes | High | High | Version the adapter and keep tolerant parsers |
| Windows command launch differences (`npx` vs `npx.cmd`) | High | Medium | Ship OS-specific docs/examples |
| Divergence between core path resolver and Claude hooks resolver | Medium | High | Single shared resolver contract + tests |
| Duplicate memory behavior with Codex native memory features | Medium | Medium | Position Locus as external durable memory, not replacement glue |
| Session files may contain sensitive prompt/response content | Medium | High | Redact before persistence and keep capture opt-in |

### Additional open questions to add

1. **What exact Codex session event types do we want to ingest?**
   Session JSONL contains multiple record types; define the allowlist before implementation.

2. **Should Codex capture be opt-in by default?**
   For privacy and expectation management, the safe default is probably yes.

3. **Do we want one universal package or a thin npm wrapper package?**
   Today the repo root is already close to publishable, so compare:
   - publish root package with a `bin`
   - publish a thin `@locus-memory/mcp-server` wrapper

4. **How should Locus interact with Codex native memories if that feature becomes stable?**
   The safest position is coexistence, not deep coupling.

### Final reviewer conclusion

**Short answer:** yes, the project can become a real Codex memory system, and the MCP foundation is
already strong enough for that. The plan is good, but it currently mixes together two different
products:

- **MCP-based persistent memory for Codex** -> realistic now
- **passive automatic conversation memory for Codex** -> realistic later, but only with a dedicated
  adapter

If you separate those two scopes clearly, downgrade plugin assumptions, and target Codex session
JSONL instead of betting on `state.db`, the plan becomes much more executable.

**Signed:** Codex
