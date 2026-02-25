# Locus v3 "Carbon Copy" — Design Document

> **Status:** Approved
> **Date:** 2026-02-25
> **Authors:** Magnifico4625 + Claude (Opus 4.6) + ChatGPT (GPT-5.2) + Gemini (v2.5 Flash)
> **Replaces:** n/a (new feature, extends Locus v2)

---

## 1. Scope & Identity

### 1.1 What Is Locus v3

**Locus v3 "Carbon Copy"** evolves Locus from a "Claude Code memory plugin" into a
**Universal AI Memory Layer** — a background system that passively captures interactions
between users and AI agents through supported adapters/sources, making them available
via MCP so any AI tool can recall past context.

**Tagline:** *"Your AI's second brain. Zero-cost capture, minimal recall."*

### 1.2 Core Principle: "Carbon Copy"

Writing on paper with carbon paper underneath — the text appears on both sheets.
The cost is only on the first sheet (conversation with AI), the second (memory) is a
free duplicate.

- User types a prompt -> text **already exists** -> copy to memory (0 tokens)
- AI responds -> response **already exists** -> copy to memory (0 tokens)
- Files change -> diffs **already exist** -> copy to memory (0 tokens)
- Tokens are spent **ONLY** when the agent retrieves from memory (recall)

### 1.3 What Does NOT Change

- 3-layer memory architecture (structural + semantic + episodic) — preserved
- 4-layer security (metadata-only > file denylist > content redaction > audit UX) — preserved
- SQLite + FTS5, zero native dependencies — preserved
- 506 existing tests — safety net for refactoring

### 1.4 What Is Added

- **Conversation event log** — a new data stream (prompts, responses, diffs) that feeds
  into existing memory layers. Not a 4th layer, but an input source that produces
  episodic entries, search indices, and enriched context.
- **Adapter system** for multiple AI tools
- **Monorepo** with packages
- **Ingest pipeline** with multi-level filtering

### 1.5 Privacy: Consent & Opt-in

By default `captureLevel=metadata` — **no prompts, responses, or diffs are stored**.
Only tool names, file paths, timestamps, exit codes, and diff stats.

Full content capture requires explicit opt-in (`LOCUS_CAPTURE_LEVEL=full`).
This is the product's #1 trust boundary.

---

## 2. Competitive Landscape

| Project | Stars | Approach | Our advantage |
|---------|-------|----------|---------------|
| claude-mem | 28.2k | Hooks + AI compression + Chroma | Broken on Windows, heavy deps, AI cost on write |
| SuperLocalMemory V2 | ~2k | 10-layer, FTS5, knowledge graph | Requires local ML models |
| Recallium | ~1k | Auto-capture + clustering | AI meta-analysis costs tokens on write |
| OpenMemory (Mem0) | ~5k | Hierarchical + embeddings | Needs embedding models, Docker |
| ByteRover/Cipher | ~3k | MCP memory layer | Explicit save from AI (tokens) |
| Supermemory | ~4k | Memory API + MCP | Cloud by default |

**Locus differentiator:** First zero-cost carbon copy memory — capture without LLM +
local-first FTS search + multi-tool support via adapters.

---

## 3. Monorepo Architecture

### 3.1 Package Structure

```
locus/
├── packages/
│   ├── core/                    # @locus/core
│   │   ├── src/
│   │   │   ├── memory/          # structural + semantic + episodic
│   │   │   ├── storage/         # SQLite + sql.js + FTS5 + migrations
│   │   │   ├── scanner/         # structural map (regex parsers)
│   │   │   ├── security/        # denylist, redact, captureLevel
│   │   │   ├── ingest/          # unified ingest pipeline
│   │   │   │   ├── pipeline.ts
│   │   │   │   ├── filters.ts
│   │   │   │   ├── classifier.ts
│   │   │   │   └── dedup.ts
│   │   │   ├── nlp/             # Phase 2: RAKE/TF-IDF
│   │   │   ├── tools/           # MCP tools
│   │   │   ├── resources/       # MCP resources
│   │   │   └── server.ts        # thin MCP wiring (no business logic)
│   │   └── package.json
│   │
│   ├── claude-code/             # @locus/claude-code
│   │   ├── hooks/
│   │   │   ├── user-prompt.js   # UserPromptSubmit -> inbox
│   │   │   ├── stop.js          # Stop -> parse transcript -> inbox
│   │   │   ├── post-tool-use.js # PostToolUse -> inbox (refactored)
│   │   │   └── hooks.json
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── package.json
│   │
│   ├── log-tailer/              # @locus/log-tailer (Phase 2, EXPERIMENTAL)
│   │   ├── src/
│   │   │   ├── tailer.ts        # fs.watch + polling engine
│   │   │   ├── parsers/
│   │   │   │   ├── cursor.ts    # state.vscdb parser
│   │   │   │   ├── windsurf.ts
│   │   │   │   ├── gemini-cli.ts
│   │   │   │   └── opencode.ts
│   │   │   └── registry.ts     # known paths per OS per tool
│   │   └── package.json
│   │
│   ├── file-ingest/             # @locus/file-ingest (universal fallback)
│   │   ├── src/
│   │   │   ├── watcher.ts       # fs.watch on .locus/inbox/
│   │   │   ├── schema.ts        # JSON schema for events
│   │   │   └── processor.ts     # validate -> forward to core ingest
│   │   └── package.json
│   │
│   └── cli-wrapper/             # @locus/cli-wrapper (Phase 2)
│       ├── src/
│       │   ├── wrap.ts          # stdout/stderr capture + tee
│       │   └── bin.ts           # CLI entry: locus wrap -- <cmd>
│       └── package.json
│
├── dist/server.js               # compat shim -> packages/core/dist/server.js
├── .mcp.json                    # points to ./dist/server.js (unchanged)
├── .claude-plugin/plugin.json   # compat proxy
├── hooks/hooks.json             # compat shim -> packages/claude-code/hooks/
├── package.json                 # npm workspaces root
├── tsconfig.base.json
├── biome.json
└── vitest.workspace.ts
```

### 3.2 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo tooling | npm workspaces | Already using npm, zero overhead, native support |
| Shared types | Exported from @locus/core | No need for separate @locus/shared package |
| MCP server location | Inside @locus/core | YAGNI — MCP is our only interface. server.ts is thin wiring, engine modules are isolated and extractable later |
| Build | esbuild per-package | Fast, already configured |
| Log Tailer | Separate package, `experimental` flag | Isolate fragile code from stable core |
| CLI Wrapper | Full-featured package, not just "option" | For CLI tools without stable native logs |

### 3.3 Package Dependencies

```
@locus/claude-code  --> .locus/inbox/ --> @locus/core
@locus/log-tailer   --> .locus/inbox/ --> @locus/core
@locus/file-ingest  --> .locus/inbox/ --> @locus/core
@locus/cli-wrapper  --> .locus/inbox/ --> @locus/core
```

All adapters communicate through the file inbox protocol. No direct DB access from
adapters. @locus/core depends only on `@modelcontextprotocol/sdk` and `zod`.

### 3.4 Compat Shims

Root-level shim files ensure `claude plugin add` works unchanged after monorepo
restructure:

- `dist/server.js` — thin launcher that re-exports `packages/core/dist/server.js`
- `.mcp.json` — points to `./dist/server.js` (unchanged path)
- `.claude-plugin/plugin.json` — proxy to `packages/claude-code/`
- `hooks/hooks.json` — proxy to `packages/claude-code/hooks/`

---

## 4. Event Protocol

### 4.1 Inbox Contract

All adapters write JSON files to the project inbox directory following this schema.

> **Inbox path:** Phase 1 uses `~/.claude/memory/locus-<hash>/inbox/` (co-located with `locus.db`). A project-local `.locus/inbox/` may be added in Phase 2 for adapters that don't know the DB path. References to `.locus/inbox/` in this document refer to whichever inbox path is active.

```jsonc
{
  "version": 1,
  "event_id": "a1b2c3d4-...",            // UUID, globally unique
  "source": "claude-code",               // adapter name
  "source_event_id": "session-xyz-42",   // ID from source (optional)
  "project_root": "/home/user/myapp",
  "session_id": "abc123",                // optional
  "timestamp": 1708876543210,            // unix ms
  "kind": "user_prompt",                 // event kind enum
  "payload": { ... }                     // varies by kind
}
```

### 4.2 Event Kinds

| kind | payload | sources |
|------|---------|---------|
| `user_prompt` | `{ prompt: string }` | hooks, log-tailer, cli-wrapper |
| `ai_response` | `{ response: string, model?: string }` | hooks (transcript), log-tailer |
| `tool_use` | `{ tool: string, files: string[], status, exitCode?, diffStats? }` | hooks |
| `file_diff` | `{ path: string, added: number, removed: number, diff?: string }` | hooks, file watcher |
| `session_start` | `{ tool: string, model?: string }` | any adapter |
| `session_end` | `{ summary?: string }` | any adapter |

### 4.3 Write Contracts

1. **Atomic write:** write to `.tmp` file -> `rename` to final name
2. **File naming:** `{timestamp}-{event_id_short}.json`
3. **One file = one event**
4. **UTF-8, no BOM**

### 4.4 CaptureLevel Gate (applied at hook level BEFORE writing to inbox)

| Level | tool_use metadata | user prompts | ai responses | file diffs |
|-------|-------------------|--------------|--------------|------------|
| `metadata` (default) | stats only | **NO** | **NO** | stats only |
| `redacted` | + command (redacted) | keywords only | **NO** | stats only |
| `full` | + full output | full text | full text | full diff |

Hooks apply captureLevel gate BEFORE writing to disk — secrets never touch inbox
in metadata mode. Pipeline applies full redact + denylist as second defense layer.

---

## 5. Ingest Pipeline

### 5.1 Pipeline Phases

```
.locus/inbox/*.json
        |
        v
+-- Phase 1: INTAKE -------------------------+
|  1. Scan inbox dir                          |
|  2. Sort by timestamp (preserve order)      |
|  3. Parse JSON, validate schema v1          |
|  4. Dedup: check event_id in ingest_log     |
|     (unique index on event_id + (source,    |
|      source_event_id), ON CONFLICT IGNORE)  |
|  5. Batch limit: max N events per run       |
+-----------------------+---------------------+
                        |
                        v
+-- Phase 2: FILTER --------------------------+
|  Level 1 -- CaptureLevel gate:              |
|    (second check, in case hook missed it)   |
|                                             |
|  Level 2 -- Significance:                   |
|    prompt < 5 words -> low significance     |
|    file created/deleted -> high             |
|    test failed -> high                      |
|    repeated read -> drop                    |
|                                             |
|  Level 3 -- Dedup:                          |
|    similar prompts within 5 min -> merge    |
|    same file diff -> merge                  |
+-----------------------+---------------------+
                        |
                        v
+-- Phase 3: TRANSFORM -----------------------+
|  1. Security: redact secrets / denylist     |
|  2. Normalize file paths                    |
|  3. Extract auto-tags (Phase 2: RAKE)       |
|  4. Classify: -> episodic / conversation    |
+-----------------------+---------------------+
                        |
                        v
+-- Phase 4: STORE ---------------------------+
|  1. Write to conversation_events            |
|  2. Write to event_files (join table)       |
|  3. Update conversation_fts index           |
|  4. Record event_id in ingest_log           |
|  5. Delete processed .json from inbox       |
|  6. Emit metrics (count, duration, skipped) |
+---------------------------------------------+
```

### 5.2 Processing Policy

| Trigger | When | Batch limit |
|---------|------|-------------|
| **Startup** | MCP server starts | All accumulated events |
| **Before recall** | Before `memory_search` / `memory_explore` | Max 50 events |
| **Debounce timer** | Every 30 sec while server is running | Max 100 events |
| **Manual** | `memory_scan` tool | All + rescan structural map |

If inbox has more than batch limit — process batch, rest waits for next trigger.
Metrics (processed / skipped / remaining) available via `memory_status`.

**Performance contract:** Inbox processing MUST NOT noticeably slow down MCP tools.

---

## 6. Adapters

### 6.1 @locus/claude-code — Primary Adapter (Phase 1)

Reliability: **HIGH** (official hooks API).

**Three hooks:**

**UserPromptSubmit:**
- Trigger: user sends a prompt
- Payload from Claude Code: `{ prompt, session_id, transcript_path, cwd }`
- Action: apply captureLevel gate -> write `kind=user_prompt` to inbox
- Note: use `transcript_path` from payload as-is (never hardcode paths)

**Stop:**
- Trigger: AI finishes responding
- Payload: `{ session_id, transcript_path, stop_hook_active }`
- Action: parse transcript JSONL -> extract new lines since last read
- State: `tailer-state.json` stores `{session_id -> last_offset}` per transcript
- Read only NEW lines, correlate with last UserPromptSubmit via session_id
- Apply captureLevel gate -> write `kind=ai_response` to inbox

**PostToolUse (refactored):**
- Trigger: after Read/Write/Edit/Bash/Glob/Grep/NotebookEdit
- Action: instead of direct SQLite write -> write `kind=tool_use` to inbox
- Default: metadata only (tool_name, file_paths, exit_code, diff_stats)
- `captureLevel=full`: + tool_output with redact

### 6.2 @locus/log-tailer — Experimental Adapter (Phase 2)

Reliability: **LOW** (internal formats may break on updates).

**Robustness requirements:**
- Read-only access to external DBs (never write)
- SQLITE_BUSY -> retry 3x -> skip + log warning
- fs.watch as primary, polling (every 5 sec) as fallback on ALL platforms
  (not just Windows — macOS/network drives also have gaps)
- Best-effort guarantee: failure to read -> log, continue, don't crash
- Project attribution: tailer MUST determine projectRoot from workspace path
  in state.vscdb or cwd in CLI logs (otherwise per-project memory breaks)

**Known source paths:**

| Tool | OS | Path | Format |
|------|----|------|--------|
| Cursor | Windows | `%APPDATA%\Cursor\User\workspaceStorage\<hash>\state.vscdb` | SQLite KV |
| Cursor | macOS | `~/Library/Application Support/Cursor/User/workspaceStorage/...` | SQLite KV |
| Cursor | Linux | `~/.config/Cursor/User/workspaceStorage/...` | SQLite KV |
| Windsurf | All | TBD (research needed) | TBD |
| Gemini CLI | All | `~/.gemini/history.jsonl` | JSONL |
| OpenCode | All | TBD (research needed) | TBD |

**How it works:**
1. On startup: scan known paths -> find existing DBs/logs
2. For each source: remember `last_read_position` (offset/rowid/timestamp)
3. Watch file (fs.watch + polling fallback)
4. On change: read new records from last_position
5. Transform to standard event -> `.locus/inbox/`
6. Update last_read_position in `.locus/tailer-state.json`

### 6.3 @locus/file-ingest — Universal Fallback (Phase 1)

Reliability: **HIGH** (simple protocol).

Any external tool/script writes JSON to `.locus/inbox/` following the event protocol.
Core processes automatically. Published JSON schema + examples enable community adapters.

### 6.4 @locus/cli-wrapper — Full Second Path (Phase 2)

Reliability: **MEDIUM** (heuristics for supported CLIs).

```bash
locus wrap -- gemini "fix the auth bug"
```

Default behavior: writes raw session transcript (stdout + stderr + cmd + exit_code).
Prompt/response parsing only for explicitly supported CLIs with `--json` or
non-interactive mode. No `>` / `>>>` marker heuristics (too fragile).

### 6.5 Adapter Summary

| Adapter | Reliability | Data completeness | Phase |
|---------|------------|-------------------|-------|
| claude-code | High (official hooks) | Full | 1 |
| file-ingest | High (simple protocol) | Depends on writer | 1 |
| log-tailer | Low (may break) | High | 2 |
| cli-wrapper | Medium (heuristics) | Medium | 2 |

---

## 7. Database Schema

### 7.1 Existing Tables (unchanged)

```sql
files              -- structural map
memories           -- semantic + episodic entries
memories_fts       -- FTS5 index for memories
hook_captures      -- legacy tool use metadata (read-only in v3)
scan_state         -- scanner state
schema_version     -- migration tracking
```

### 7.2 New Tables (migration v2)

```sql
CREATE TABLE IF NOT EXISTS conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  project_root TEXT NOT NULL,
  session_id TEXT,
  timestamp INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT,
  significance TEXT,         -- 'high' | 'medium' | 'low'
  tags_json TEXT,            -- auto-extracted tags
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_event_id
  ON conversation_events(event_id);
CREATE INDEX IF NOT EXISTS idx_ce_timestamp
  ON conversation_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_ce_kind
  ON conversation_events(kind);
CREATE INDEX IF NOT EXISTS idx_ce_session
  ON conversation_events(session_id);

CREATE TABLE IF NOT EXISTS event_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES conversation_events(event_id)
);

CREATE INDEX IF NOT EXISTS idx_ef_file_path
  ON event_files(file_path);
CREATE INDEX IF NOT EXISTS idx_ef_event_id
  ON event_files(event_id);

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
  content,
  content=conversation_events,
  content_rowid=id
);

CREATE TABLE IF NOT EXISTS ingest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  processed_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_il_event_id
  ON ingest_log(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_il_source
  ON ingest_log(source, source_event_id);
```

### 7.3 Migration Rules

- All migrations use `IF NOT EXISTS` (idempotent)
- Only @locus/core runs migrations (adapters never touch schema)
- `hook_captures` remains as read-only legacy (migration to conversation_events = v3.1)
- DB path unchanged: `~/.claude/memory/locus-<hash>/locus.db`
- Schema version: `2` (current = `1`)

---

## 8. Search & Recall

### 8.1 Extended memory_search

```typescript
// v2 API (backwards compatible, continues to work):
memory_search({ query: "JWT auth" })

// v3 API (new optional fields):
memory_search({
  query: "JWT auth",
  timeRange?: { from?, to?, relative?: "today" | "yesterday" | "this_week" | "last_7d" | "last_30d" },
  filePath?: "src/auth/**",
  kind?: ["user_prompt", "ai_response"],
  source?: ["claude-code"],
  limit?: 20,
  offset?: 0
})
```

**Search strategy:**
1. `query` -> FTS5 MATCH on `conversation_fts` (separate from `memories_fts`)
2. `timeRange` -> WHERE timestamp BETWEEN (computed server-side in user's local TZ)
3. `filePath` -> JOIN event_files WHERE file_path GLOB pattern
4. `kind` / `source` -> WHERE filters
5. All combined with AND
6. Results returned per-layer (no cross-layer rank comparison)

**Scoring:** `score = bm25(fts) + 0.2 * recency_score` where recency_score
normalized to [0..1]. Additive formula, not multiplicative.

### 8.2 memory_timeline (NEW, Phase 1 Should)

```typescript
memory_timeline({
  timeRange: { relative: "today" },
  kind?: ["user_prompt", "file_diff"],
  filePath?: "src/auth/**",
  summary?: true,             // default: true (headers + ids only)
  limit?: 20                  // default: 20
})
```

Returns chronological event feed. Summary mode by default (no full content,
just event kind + timestamp + file paths + first sentence).

### 8.3 MCP Resources

| Resource | Content | Token budget |
|----------|---------|-------------|
| `locus://project-map` | Structural map (unchanged) | <2k tokens |
| `locus://decisions` | Semantic decisions (unchanged) | <500 tokens |
| `locus://recent` | Recent activity (enhanced) | <1k tokens |

**`locus://recent` enhancement:**
- Always shows: recent files changed, commands executed, event counts
- At `captureLevel=full`: also shows last 3-5 user prompts (hard limit)
- Never shows AI responses in auto-injected resource (too large)

---

## 9. Backwards Compatibility

### 9.1 API Contracts

| Surface | Guarantee |
|---------|-----------|
| MCP tools (memory_search, explore, remember, forget, etc.) | Existing params unchanged. New params are optional/additive only. Return types: new fields OK, no changes to existing field types |
| MCP resources (project-map, decisions, recent) | Output format preserved, recent extended |
| `claude plugin add` | Works unchanged via compat shims |
| Env vars (LOCUS_CAPTURE_LEVEL, etc.) | All current vars continue working |
| DB file location | `~/.claude/memory/locus-<hash>/locus.db` — unchanged |

### 9.2 Monorepo Migration Path

**Step 1:** Restructure flat repo -> packages/ + root compat shims (dist/, .mcp.json, hooks/)
**Step 2:** Extract core API boundary (thin server.ts, isolated engine modules)
**Step 3:** Add new packages (file-ingest skeleton, empty log-tailer/cli-wrapper)

---

## 10. Phase 1 MVP Scope

### 10.1 Must (blocks release)

1. Monorepo scaffold + compat shims + `claude plugin add` works
2. DB migration v2 (new tables, hook_captures stays as-is legacy)
3. Ingest pipeline (inbox -> validate -> captureLevel gate -> redact -> dedup -> store)
4. 3 hooks (UserPromptSubmit + Stop + PostToolUse refactor -> inbox)
5. 3-level filtering (type -> significance -> dedup)
6. memory_search extension (+ timeRange, filePath, kind optional params)
7. locus://recent enhancement (with limits and captureLevel gate)

### 10.2 Should (Phase 1 if time allows)

8. memory_timeline (summary-only default, limit=20)

### 10.3 Could (v3.1)

9. hook_captures -> conversation_events one-time migration
10. Decision detector (regex-based auto-tags)
11. RAKE/TF-IDF keyword extraction

### 10.4 Definition of Done

```
[ ] Monorepo: npm install + npm run build + npm test from root
[ ] Compat shims: claude plugin add installs without changes for user
[ ] All 506 existing tests pass
[ ] Ingest pipeline processes events from .locus/inbox/
[ ] 3 hooks write to inbox (UserPromptSubmit + Stop + PostToolUse)
[ ] CaptureLevel gate: metadata default, prompts/responses only at full
[ ] Redact/denylist at hook level (safety) AND pipeline level (full)
[ ] Dedup: restart does not create duplicates (event_id unique index)
[ ] Atomic write in inbox (.tmp -> rename)
[ ] memory_search finds conversation events by keywords + time + file
[ ] locus://recent shows safe minimum at metadata, prompts at full (max 3-5)
[ ] Inbox processing does not slow down tools (batch limit + metrics)
[ ] New tests for all new components (target: >90% coverage for new code)
[ ] README updated: new features, captureLevel documentation
```

### 10.5 Implementation Order

```
1. Monorepo scaffold + compat shims
   |
2. DB migration v2 (new tables)
   |
3. Ingest pipeline (core)
   |
   +------ 4. Hooks (3 hooks -> inbox) [parallel]
   |
   +------ 5. Filters (3-level) [parallel]
   |
6. memory_search extension
   |
   +------ 7. locus://recent enhancement [parallel]
   |
   +------ 8. memory_timeline [parallel, Should]
```

Steps 4-5 can run in parallel (independent modules).
Steps 6-7-8 can run in parallel (independent tools/resources).

### 10.6 Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Monorepo restructure breaks paths | High | Compat shims + integration test: `claude plugin add` from scratch |
| Transcript JSONL format changes | Medium | Defensive parsing: unrecognized format -> log warning, skip, don't crash |
| Inbox overflow at heavy usage | Low (~50KB/day) | Processing policy with batch limits + metrics in memory_status |
| SQLite locks (hook + server) | Eliminated | Inbox architecture solves this by design |
| captureLevel=full leaks secrets | High | Double redact (hook + pipeline) + denylist + risk documentation |
| 506 tests regression | Medium | CI: all tests pass before merge. Incremental refactoring |

---

## 11. Versioning Roadmap

```
v2.x  -- current Locus (Claude Code plugin, flat repo)
v3.0  -- monorepo, ingest pipeline, conversation capture (Claude Code)
v3.1  -- hook_captures migration, decision detector, RAKE auto-tags
v3.2  -- log-tailer (Cursor), cli-wrapper
v3.x  -- Windsurf, VSCode, additional parsers
v4.0  -- locus serve (HTML dashboard), breaking changes if needed
```

Minor versions: new features/adapters through existing tables or additive migrations.
Major versions: only for breaking changes in MCP API or DB schema.

---

## 12. Architecture Diagram

```
Adapters (WRITE, 0 tokens):                Core (READ + PROCESS):

+----------------+                         +---------------------------+
| claude-code    |--\                      |                           |
| (hooks)        |   \                     |   Ingest Pipeline         |
+----------------+    \                    |   +-------------------+   |
                       \                   |   | validate schema   |   |
+----------------+      +-> .locus/inbox/ -+-> | captureLevel gate |   |
| log-tailer     |     /   (JSON files)    |   | redact / denylist |   |
| (experimental) |    /                    |   | classify + dedup  |   |
+----------------+   /                     |   | store in DB       |   |
                    /                      |   +-------------------+   |
+----------------+ /                       |                           |
| file-ingest    |/                        |   MCP Server (recall)     |
| (universal)    |                         |   memory_search           |
+----------------+                         |   memory_timeline         |
                                           |   memory_explore          |
+----------------+                         |   locus://recent          |
| cli-wrapper    |---> .locus/inbox/ ------+-> locus://decisions       |
| (Phase 2)      |                         |   locus://project-map     |
+----------------+                         +---------------------------+
```

All adapters -> one entry point (file inbox) -> core processes uniformly.

---

*Document produced collaboratively by Claude (Opus 4.6), ChatGPT (GPT-5.2),
and Gemini (v2.5 Flash) in a multi-model brainstorming session, February 2026.*
