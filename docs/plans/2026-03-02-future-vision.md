# Locus Future Vision — AI Council Final Document

> **Status:** Council review complete, fact-checked
> **Date:** 2026-03-02 (draft) / 2026-03-03 (final)
> **Council:** Claude Opus 4.6 (drafter), GPT-5.2 (reviewer), Gemini CLI (reviewer), Qwen Code (reviewer)
> **Removed:** OpenCode (bias — recommended itself as P0, outdated advice on Pattern B vs C)

---

## Where We Are (v3.0.2)

Locus is a persistent memory plugin for AI coding tools. Three memory layers:
- **Structural** — auto-parsed file/export/import map (0 tokens, regex)
- **Semantic** — user-saved decisions with tags and redaction
- **Episodic** — compressed session history

Plus **Carbon Copy** (v3.0) — passive conversation capture via inbox-based event protocol.

**Current reality (fact-checked 2026-03-03):**
- Works fully in Claude Code (12 MCP tools + 3 resources + 3 hooks)
- Works partially in Cursor/Windsurf/Cline/Zed (MCP tools + resources, but NO conversation capture)
- CLI tools (Gemini CLI, Codex CLI, Qwen Code, OpenCode) **support MCP natively** — can use Locus MCP tools, but no conversation capture without hooks/adapters

**The gap:** ~75% of Locus value (structural + semantic) works everywhere MCP works. The remaining ~25% (conversation capture) only works in Claude Code. And there's no way to SEE your memory visually.

**Key correction by GPT-5.2:** The original draft stated CLI tools "don't work at all". This was wrong — Gemini CLI (`gemini mcp add`), Codex CLI (`codex mcp-server`), Qwen Code, and OpenCode all support MCP natively. Pattern C (MCP-Native Capture) is therefore more viable than originally proposed.

Sources:
- [Gemini CLI MCP docs](https://geminicli.com/docs/tools/mcp-server/)
- [Codex CLI MCP docs](https://developers.openai.com/codex/mcp/)
- [Qwen Code MCP docs](https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/)
- [Cursor MCP docs](https://cursor.com/docs/context/mcp)
- [Windsurf MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp)

---

## The Key Architectural Insight

Our inbox protocol is already tool-agnostic:

```
Any Source → writes InboxEvent JSON → inbox/ dir → 4-phase pipeline → SQLite
```

The pipeline doesn't care WHO wrote the JSON file. It processes whatever lands in the inbox. This means adding a new tool = writing a new **adapter** that produces `InboxEvent` files. Zero changes to core.

Current `InboxEvent` contract:
```json
{
  "version": 1,
  "event_id": "uuid",
  "source": "claude-code",
  "session_id": "optional",
  "project_root": "/path/to/project",
  "timestamp": 1709312345,
  "kind": "user_prompt | ai_response | tool_use | file_diff | session_start | session_end",
  "payload": { ... }
}
```

The `source` field already supports arbitrary values. A Cursor adapter would write `"source": "cursor"`, Gemini CLI would write `"source": "gemini-cli"`, etc.

---

## Phase 1: v3.1 — Stabilization & Internal Cleanup

**Goal:** Clean up v3.0 debt before expanding.

### 1.1 hook_captures → conversation_events migration
- `hook_captures` table is legacy from v2 — still populated, still read
- Write a one-time migration that converts old hook_captures rows into conversation_events
- Use deterministic `source_event_id` for dedup (idempotent reruns)
- Mark hook_captures as deprecated (read-only), don't drop until v4
- Add `memory_doctor` check: "legacy hook_captures migrated: yes/no, count"

**Council consensus on migration safety (GPT-5.2 + Qwen):**
- Idempotency: migration must be safe for repeated runs
- Dedup via `source_event_id` to prevent duplicates
- Keep `hook_captures` table until v4.0 (no DROP)
- Integration test: "file in inbox → rows in conversation_events/event_files/ingest_log"

### 1.2 Decision Detector
- Analyze conversation events for phrases like "let's use X", "we decided Y", "the approach is Z"
- Rule-based keyword/pattern matching (not LLM) — runs during ingest pipeline Transform phase
- **Suggests, never auto-saves** (user must confirm)

**Council consensus (GPT-5.2 + Qwen):**
- Use `memory_suggestions` table (not auto-save to `memories`)
- New MCP tool: `memory_suggestions list/apply/dismiss`
- Decision detector runs on `user_prompt` and `ai_response` events
- Confidence levels: high (explicit decisions), medium (pattern match), low (heuristic)

### 1.3 Adapter Interface formalization
- Extract the implicit contract between hooks and inbox into a typed `Adapter` interface
- Document: what an adapter MUST produce, what's optional, error handling contract

**Council consensus (GPT-5.2):**
- Create `@locus/adapter-kit` shared package with:
  - Deterministic `source_event_id` generation
  - Path normalization (Windows/POSIX)
  - Atomic write to inbox (.tmp→rename)
  - `InboxEvent v1` validators (re-export from core)

**Estimated scope:** 2-3 weeks.

---

## Phase 2: v3.2 — Universal Adapters (MCP-Native First)

**Goal:** Conversation capture for major AI coding tools.

**Council-revised strategy:** Pattern C (MCP-Native) is P0 for all MCP-capable tools. Pattern A (Log Tailer) and B (CLI Wrapper) are fallbacks only.

### Integration Patterns

**Pattern A: Log Tailer** (for IDEs without MCP-native capture hooks)
- Targets: Cursor (fallback), Windsurf (fallback)
- Watches IDE log files, extracts events
- Best-effort parsing — fragile, formats change between versions
- Config override for log paths (env/CLI flag)

**Pattern B: CLI Wrapper** (universal fallback for non-MCP tools)
- Wraps any CLI: `locus wrap <command>`
- Intercepts stdin (user prompts) and stdout (AI responses)
- **Pipe mode only** (no PTY) — covers 80% of use cases
- For MCP-capable CLIs, Pattern C is preferred

**Pattern C: MCP-Native Capture** (primary for MCP-capable clients)
- New MCP tool: `memory_capture_event`
- Client calls this to report events directly
- Zero external infrastructure needed
- Works with: Gemini CLI, Codex CLI, Qwen Code, Cursor, Windsurf, Cline

### Revised Adapter Priority Matrix (fact-checked)

| Tool | Best Pattern | Fallback | Priority | MCP Support |
|------|-------------|----------|----------|-------------|
| Cursor | C (MCP-Native) | A (Log Tailer) | P0 | `.cursor/mcp.json` |
| Gemini CLI | C (MCP-Native) | B (CLI Wrapper) | P0 | `gemini mcp add` |
| Windsurf | C (MCP-Native) | A (Log Tailer) | P1 | `mcp_config.json` (stdio, HTTP, SSE) |
| Codex CLI | C (MCP-Native) | B (CLI Wrapper) | P1 | `codex mcp-server` |
| Qwen Code | C (MCP-Native) | B (CLI Wrapper) | P1 | Native MCP support |
| Cline | C (MCP-Native) | A (Log Tailer) | P2 | `cline_mcp_settings.json` |
| aider | B (CLI Wrapper) | — | P2 | No MCP |
| Zed | A (Log Tailer) | — | P2 | Limited MCP |

**Key change from original draft:** Windsurf DOES have full MCP support (stdio, Streamable HTTP, SSE, OAuth). Both Gemini and Qwen incorrectly claimed it didn't. Verified via [Windsurf MCP docs](https://docs.windsurf.com/windsurf/cascade/mcp).

### Release strategy (GPT-5.2 recommendation — adopted)

Split v3.2 into v3.2 + v3.3 to avoid supporting too many formats at once:

```
v3.2: Pattern C tool (memory_capture_event) + Cursor guide + Gemini CLI guide
v3.3: Remaining adapters + Pattern A/B fallbacks where needed
```

**Estimated scope:** v3.2: 2-3 weeks. v3.3: 2-3 weeks.

---

## Phase 3: v4.0 — HTML Dashboard

**Goal:** Visual interface for exploring and managing Locus memory.

### Architecture: Embedded HTTP Server (council consensus)

```
MCP Server (stdio) <-> AI Client
     | (also starts)
HTTP Server (:9315) <-> Browser Dashboard
     | (reads)
SQLite DB (same file, WAL mode, read-only)
```

- MCP server spawns a lightweight HTTP server on a local port
- Dashboard is a static SPA bundled into the dist
- API endpoints serve JSON from the same SQLite DB
- New MCP tool: `memory_dashboard` → opens browser to localhost:9315

**Council consensus:**
- **Embedded** in MCP server with `--no-dashboard` flag
- **Localhost-only** — no auth needed for v4.0
- **Remote dev:** document SSH tunnel (`ssh -L 9315:localhost:9315`), optional `LOCUS_DASHBOARD_TOKEN` env var in v4.1
- **Port fallback:** if 9315 occupied, try 9316+, auto-open optional (`--open` flag)

### Dashboard Features (MVP)

1. **Project Map Visualization** — interactive tree of files/exports/imports
2. **Memory Timeline** — chronological view with filters (kind, source, file, time)
3. **Decisions Browser** — semantic memories with tags, search, CRUD
4. **Stats Dashboard** — DB size, event counts, per-source activity
5. **Health Monitor** — doctor checks, inbox queue depth

### Tech Stack

**Council lean:** Preact + HTM or vanilla JS. Dashboard is read-only, doesn't need complex state management. Keep it light.

**Estimated scope:** 3-4 weeks for MVP.

---

## Phase 4: v5.0+ — Intelligence Layer (Far Future)

Ideas for post-v4, not yet designed:

- **Cross-project memory** — shared decisions across repos ("we always use pnpm")
- **Auto-decision extraction** — LLM-based analysis of conversation history
- **Memory decay** — old, unused memories automatically downgraded in relevance
- **Team memory** — shared Locus DB for teams (requires auth, conflict resolution)
- **Multi-agent orchestration** — `work_item_id` in InboxEvent for cross-agent session linking (Gemini suggestion)

These are deliberately vague — design them when v4.0 ships.

---

## Architecture Principles (Council Consensus)

1. **Inbox is the universal interface.** Every adapter writes InboxEvent JSON. Core never changes for new tools.
2. **Zero mandatory dependencies.** No chokidar, no React, no Python. Pure Node.js where possible.
3. **Graceful degradation.** If an adapter fails, MCP tools still work. If FTS5 is missing, LIKE fallback. If dashboard is down, CLI works.
4. **Metadata by default.** Never store raw content unless user opts in. Non-negotiable.
5. **Adapter parsers are best-effort.** IDE logs change. Parsers extract what they can, skip what they can't, never crash.
6. **One DB, many readers.** Dashboard, MCP server, and future tools all read the same SQLite file. WAL mode handles concurrent reads.
7. **No breaking changes to InboxEvent v1** until 2+ adapters are in production (GPT-5.2).
8. **One inbox consumer.** Only the pipeline processes inbox files. Dashboard reads DB only (GPT-5.2).
9. **Test contracts, not implementations.** Integration tests: "file in inbox → rows in DB" (GPT-5.2).

---

## Council Answers to Open Questions

All council members agreed on these answers:

### 1. Log-tailer: daemon vs on-demand?
**Unanimous: On-demand.** Starts with MCP server, lives while session lives.
- Daemon creates lifecycle/install/debug problems, especially on Windows
- Security concern with permanent background process

### 2. CLI wrapper: pipe vs PTY?
**Unanimous: Pipe for MVP.** PTY only later if explicit user demand.
- PTY requires native deps (node-pty), breaks on Alpine/ARM64/Windows
- Pipe covers 80% of use cases
- Pattern C (MCP-Native) may make wrapper unnecessary for most CLIs

### 3. Dashboard: embedded vs standalone?
**Unanimous: Embedded** in MCP server with `--no-dashboard` flag.
- One process, one config, auto-start with MCP
- Standalone `locus dashboard --port 9315` as optional bonus for remote dev

### 4. VS Code extension (Pattern D)?
**Unanimous: Don't build in v3.x.**
- Fragmented fork ecosystem (Cursor, Windsurf, Cline — different APIs)
- Separate release cycle (marketplace moderation)
- Pattern C (MCP-Native) covers the same use cases

### 5. InboxEvent v2: schema changes?
**Unanimous: Don't change until concrete need from 2+ adapters.**
- Current v1 schema works for all known use cases
- Evolve only when an adapter can't express an event in v1

### 6. Multi-tool simultaneous capture?
**Unanimous: Already works** via `source` + `source_event_id` dedup.
- Cross-source session linking deferred to v5.0
- No evidence of real user demand yet

### 7. Dashboard authentication?
**Unanimous: Localhost-only, no auth for v4.0.**
- Document SSH tunnel for remote dev
- Optional `LOCUS_DASHBOARD_TOKEN` in v4.1 if demand appears

---

## Roadmap Summary

```
v3.1 (2-3 weeks)           v3.2 (2-3 weeks)         v3.3 (2-3 weeks)
────────────────            ────────────────          ────────────────
hook_captures migration     memory_capture_event      Pattern A/B fallbacks
Decision detector           Cursor MCP guide          Windsurf log-tailer
  (suggestions only)        Gemini CLI MCP guide      Codex CLI wrapper
Adapter interface           adapter-kit package       Remaining adapters
  formalization

v4.0 (3-4 weeks)            v5.0+ (future)
────────────────             ────────────────
HTML dashboard               Cross-project memory
Embedded HTTP server          Auto-decisions
Preact/vanilla SPA            Team memory
memory_dashboard tool         Multi-agent orchestration
```

---

## MCP Ecosystem Context (2026)

Verified facts relevant to Locus strategy:

- **MCP in AAIF (Linux Foundation):** December 9, 2025 — Anthropic donated MCP to the Agentic AI Foundation. Co-founded by Anthropic, OpenAI, Block. Platinum members: AWS, Google, Microsoft, Cloudflare, Bloomberg. ([Source](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation))
- **MCP Tasks (SEP-1686):** Introduced in spec version 2025-11-25. **Experimental.** Durable state machines for long-running operations (batch processing, CI/CD). NOT for reducing token cost of capture. ([Spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks))
- **MCP adoption:** All major tools now support MCP — Claude Code, Cursor, Windsurf, Cline, Gemini CLI, Codex CLI, Qwen Code, OpenCode, Zed. Universal reach for Locus MCP tools.

---

## Fact-Check Log

| Claim | Source | Verdict |
|-------|--------|---------|
| Gemini CLI supports MCP natively | GPT-5.2, Qwen | **TRUE** — `gemini mcp add` command exists |
| Codex CLI supports MCP, can run as MCP server | GPT-5.2, Qwen | **TRUE** — `codex mcp-server` over stdio |
| Cursor supports `.cursor/mcp.json` | Qwen | **TRUE** — global and project-level config |
| Windsurf has NO MCP integration | Gemini, Qwen | **FALSE** — supports stdio, HTTP, SSE, OAuth |
| MCP transferred to Linux Foundation (AAIF) | Gemini | **TRUE** — December 9, 2025 |
| SEP-1686 Tasks reduce token cost | Gemini | **MISLEADING** — Tasks are for long-running ops, still need tool call |
| OpenCode should be P0 adapter | OpenCode | **BIAS** — conflict of interest, self-recommendation |
| Pattern B is more reliable than Pattern C | OpenCode | **OUTDATED** — most CLI tools already support MCP natively |
| Qwen CLI has MCP support | Fact-check | **TRUE** — native MCP support confirmed |

---

## Council Member Assessment

| Member | Accuracy | Key Contribution | Issues |
|--------|----------|-------------------|--------|
| **GPT-5.2** | 5/6 | Corrected MCP facts, adapter-kit, v3.2/v3.3 split, safety principles | One unverified third-party URL |
| **Gemini** | 3/6 | AAIF context, SEP-1686 awareness, multi-agent ideas | Windsurf error, misleading Tasks claims |
| **Qwen** | 4/6 | Detailed risk analysis, corrected priority matrix, release plan | Windsurf error, code with wrong node:sqlite API |
| **OpenCode** | 2/6 | CLI wrapper streaming code | Bias (self as P0), outdated Pattern B advice, missed Qwen MCP |

**Recommendation:** Invite GPT-5.2 and Qwen for future councils. Gemini with caution (verify ecosystem claims). Do not invite OpenCode (bias + outdated advice).
