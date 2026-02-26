# Locus v3 "Carbon Copy" Implementation Plan

**Goal:** Transform Locus from a flat Claude Code plugin into a monorepo with universal "Carbon Copy" memory — zero-cost passive capture of prompts, AI responses, and file changes via an inbox-based ingest pipeline.

**Architecture:** Monorepo (npm workspaces) with `@locus/core` (memory engine + MCP server) and `@locus/claude-code` (hooks adapter). Adapters write JSON events to the project inbox (`~/.claude/memory/locus-<hash>/inbox/`, co-located with the DB), core processes them through a 4-phase ingest pipeline (intake, filter, transform, store) into new `conversation_events` + `conversation_fts` tables. Existing 506 tests are the safety net. Root compat shims ensure `claude plugin add` continues to work.

> **Note on inbox path:** Phase 1 uses `~/.claude/memory/locus-<hash>/inbox/` (next to `locus.db`). A project-local `.locus/inbox/` may be added in Phase 2 for tools that don't know the DB path.

**Tech Stack:** TypeScript, Node 22+, SQLite (node:sqlite + sql.js fallback), FTS5, MCP SDK, esbuild, vitest, biome, npm workspaces

**Design doc:** `docs/plans/2026-02-25-carbon-copy-design.md`

---

## Conventions

- **TDD:** Write failing test, verify failure, implement, verify pass, commit
- **Biome:** Single quotes, semicolons, trailing commas, 100 char line width, spaces indent 2
- **Tests:** `vitest` with `describe`/`it`, colocated in `tests/` mirror of `src/`
- **Commits:** Conventional commits (`feat:`, `refactor:`, `test:`, `fix:`). Git operations (branch/commit) are **optional** — only when explicitly requested
- **DB patterns:** `IF NOT EXISTS` for all DDL, `DatabaseAdapter` interface for queries
- **Inbox path (Phase 1):** `~/.claude/memory/locus-<hash>/inbox/` (co-located with DB)
- **Security:** Never store secrets on disk. CaptureLevel gate at hook level (first defense) AND pipeline level (second defense)
- **Hooks:** Plain JS (not TypeScript), standalone DB-free, never crash (try/catch everything)
- **Safe subprocess calls:** Use `execFileSync` with array args instead of `exec` (prevents shell injection)
- **Git:** All "Commit" steps throughout this plan are **optional** — only create commits when explicitly requested by the user

---

## Task 1: Monorepo Scaffold ✅ DONE

**Goal:** Restructure flat repo into npm workspaces monorepo without breaking anything.
**Status:** Completed (commit `2b9c798`). 506/506 tests pass. Build OK. Typecheck OK.
**Note:** Used root `vitest.config.ts` instead of `vitest.workspace.ts` due to vitest v4 workspace mode not propagating `testTimeout` from child configs.

**Files:**
- Modify: `package.json` (add workspaces)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/claude-code/package.json`
- Move: `src/` to `packages/core/src/`
- Move: `hooks/` to `packages/claude-code/hooks/`
- Move: `tests/` to `packages/core/tests/`
- Rename: `tsconfig.json` to `tsconfig.base.json` (shared base)
- Move: `esbuild.config.ts` to `packages/core/esbuild.config.ts`
- Create: `vitest.workspace.ts`

**Step 1: (Optional) Create branch**

Run: `git checkout -b feat/v3-carbon-copy` (only if requested)

**Step 2: Create packages/core/package.json**

Name: `@locus/core`, version `3.0.0`, private, type module. Dependencies: `@modelcontextprotocol/sdk`, `zod`. Optional: `sql.js`. Dev: `@types/node`, `esbuild`, `typescript`, `vitest`.

**Step 3: Move src/, tests/, esbuild.config.ts to packages/core/**

Use `git mv` to preserve history.

**Step 4: Create packages/core/tsconfig.json**

Extends `../../tsconfig.base.json`, sets outDir/rootDir.

**Step 5: Rename root tsconfig.json to tsconfig.base.json**

Keep all compilerOptions, remove rootDir/outDir/include/exclude.

**Step 6: Create packages/claude-code/ and move hooks**

`git mv hooks/ packages/claude-code/hooks/`. Create `packages/claude-code/package.json` (name: `@locus/claude-code`). Copy `.claude-plugin/plugin.json`.

**Step 7: Update root package.json**

Add `"workspaces": ["packages/*"]`. Move biome and vitest coverage to root devDependencies. Update scripts to use workspaces.

**Step 8: Create vitest.workspace.ts at root**

Define workspace pointing to `packages/core`.

**Step 9: Update biome.json**

Add `!**/packages/*/dist/` to file excludes.

**Step 10: Run full build and test suite**

Run: `npm install && npm run build && npm test`
Expected: All 506 tests pass. Build produces `packages/core/dist/server.js`.

**Step 11: Commit**

Message: `refactor: restructure to npm workspaces monorepo`

---

## Task 2: Compat Shims ✅ DONE

**Goal:** Root-level shim files so `claude plugin add` and `.mcp.json` work unchanged.
**Status:** Completed. Root esbuild.config.ts builds to dist/server.js. Root hooks/hooks.json shim created. 506/506 tests pass. Build OK.

**Files:**
- Create: root `esbuild.config.ts` (builds from packages/core/src/server.ts to dist/server.js)
- Verify: `.mcp.json` points to `dist/server.js`
- Create: `hooks/hooks.json` (root shim pointing to packages/claude-code/hooks/)
- Verify: `.claude-plugin/plugin.json` still works

**Step 1: Create root esbuild.config.ts**

Entry point: `packages/core/src/server.ts`. Output: `dist/server.js`. Same config as current (esm, node20, external node:* and sql.js).

**Step 2: Create root hooks/hooks.json shim**

Points commands to `${CLAUDE_PLUGIN_ROOT}/packages/claude-code/hooks/post-tool-use.js`.

**Step 3: Verify .mcp.json unchanged**

Already points to `dist/server.js` at root level. No change needed.

**Step 4: Update root package.json build script**

`"build": "node esbuild.config.ts"` at root level.

**Step 5: Test full build chain**

Run: `npm run build && npm test`
Expected: Builds successfully, all tests pass.

**Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 7: Commit**

Message: `feat: add compat shims for monorepo migration`

---

## Task 3: Conversation Event Types ✅ DONE

**Goal:** Define TypeScript types for event protocol, inbox events, and new DB rows.
**Status:** Completed (commit `15be273`). Typecheck OK. 506/506 tests pass.

**Files:**
- Modify: `packages/core/src/types.ts`

**Types added:**
- `EventKind` (6 event kinds), `EventSignificance` (3 levels)
- Payload interfaces: `UserPromptPayload`, `AiResponsePayload`, `ToolUsePayload`, `FileDiffPayload`, `SessionStartPayload`, `SessionEndPayload`
- `InboxEvent` (JSON file protocol schema)
- DB rows: `ConversationEventRow`, `EventFileRow`, `IngestLogRow`
- `IngestMetrics` (pipeline output with remaining count)
- `TimeRange` + `TimeRangeRelative` (for extended search)

**Step 1: Add types**

Add `EventKind`, `EventSignificance`, `InboxEvent`, `ConversationEventRow`, `EventFileRow`, `IngestMetrics`, `TimeRange` types to types.ts. See design doc Section 4 for schema.

**Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: No errors.

**Step 3: Commit**

Message: `feat: add conversation event types for Carbon Copy protocol`

---

## Task 4: Database Migration v2 ✅ DONE

**Goal:** Add conversation_events, event_files, conversation_fts, and ingest_log tables.
**Status:** Completed. 520/520 tests pass. Schema version updated to 2. All 4 tables + indexes created. FTS5 conditional. Idempotent. v1 data preserved.

**Files:**
- Modify: `packages/core/src/storage/migrations.ts`
- Test: `packages/core/tests/storage/migrations.test.ts`

**Step 1: Write failing tests**

Tests for: conversation_events table exists, ingest_log unique index works (insert same event_id twice = 1 row), conversation_fts created when fts5 available, migration is idempotent (run twice = no error), existing v1 data preserved.

**Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/tests/storage/migrations.test.ts -v`
Expected: FAIL

**Step 3: Implement migrationV2**

Add `migrationV2(db, fts5)` function. Creates conversation_events, event_files, conversation_fts (if fts5), ingest_log. All with `IF NOT EXISTS`. Update schema_version from 1 to 2.

Update `runMigrations` to call `migrationV2` when `currentVersion < 2`.

**Step 4: Run tests to verify pass**

Expected: All pass.

**Step 5: Run full suite**

Run: `npm test`
Expected: All 506+ tests pass.

**Step 6: Commit**

Message: `feat: add DB migration v2 for conversation events tables`

> **Note: hook_captures stays as legacy.** The existing `hook_captures` table is NOT migrated to `conversation_events` in Phase 1. It remains read-only. One-time backfill migration is deferred to v3.1 (see design doc Section 10.3).

---

## Task 5: Inbox Writer Utility ✅ DONE

**Goal:** Shared utility for atomically writing events to the project inbox (`~/.claude/memory/locus-<hash>/inbox/`).
**Status:** Completed (commit `265a6e9`). 5 tests. 525/525 total tests pass. Typecheck OK. Biome OK.

**Files:**
- Create: `packages/core/src/ingest/inbox-writer.ts`
- Test: `packages/core/tests/ingest/inbox-writer.test.ts`

**Step 1: Write failing tests**

Tests for: writes valid JSON file, no .tmp files left after write, filename matches `{timestamp}-{event_id_short}.json`, creates inbox dir if missing.

**Step 2: Run test to verify failure**

Expected: FAIL (module not found)

**Step 3: Implement inbox-writer.ts**

`writeInboxEvent(inboxDir, event)`: mkdirSync if needed, write to `.tmp`, renameSync to final.

**Step 4: Run tests to verify pass**

**Step 5: Commit**

Message: `feat: add atomic inbox writer utility for event protocol`

---

## Task 6: Ingest Pipeline Core (Schema + Dedup + Intake) ✅ DONE

**Goal:** Pipeline that reads inbox, validates schema, dedup checks, respects batch limits.
**Status:** Completed. 41 new tests (19 schema + 8 dedup + 14 pipeline). 566/566 total tests pass. Typecheck OK. Biome OK.
**Note:** Zod v4 requires `z.record(z.string(), z.unknown())` instead of `z.record(z.unknown())` — single-arg record is broken in v4.

**Files:**
- Create: `packages/core/src/ingest/schema.ts`
- Create: `packages/core/src/ingest/dedup.ts`
- Create: `packages/core/src/ingest/pipeline.ts`
- Test: `packages/core/tests/ingest/schema.test.ts`
- Test: `packages/core/tests/ingest/dedup.test.ts`
- Test: `packages/core/tests/ingest/pipeline.test.ts`

**Step 1: Write schema validation tests**

Valid events pass. Invalid events (missing version, wrong kind, no event_id, non-object) rejected.

**Step 2: Implement schema.ts**

Zod schema matching InboxEvent. `validateInboxEvent(json: unknown): InboxEvent | null`.

**Step 3: Write dedup tests**

`isDuplicate(db, eventId)` returns false first, true after record. `recordProcessed(db, event)` writes to ingest_log.

**Step 4: Implement dedup.ts**

Check ingest_log for event_id. INSERT OR IGNORE for idempotent recording.

**Step 5: Write pipeline intake tests**

Empty inbox returns `{processed: 0}`. Valid events processed and deleted. Invalid JSON skipped. Duplicate event_id skipped. Batch limit respected.

**Step 6: Implement pipeline.ts intake phase**

`processInbox(inboxDir, db, config, options)`: scan dir, sort by filename, validate, dedup, batch limit.

**Step 7: Run all tests**

**Step 8: Commit**

Message: `feat: ingest pipeline intake with schema validation and dedup`

---

## Task 7: Ingest Filters (3-level) ✅ DONE

**Goal:** CaptureLevel gate, significance classification, similarity dedup.
**Status:** Completed. 28 tests. 612/612 total tests pass. Typecheck OK. Biome OK.
**Note:** Similarity dedup uses LIKE queries within 5-minute window for user_prompt and file_diff. conversation_fts changed from external content table to standalone FTS5 table (content= removed) to avoid column name mismatch with conversation_events.

**Files:**
- Create: `packages/core/src/ingest/filters.ts`
- Test: `packages/core/tests/ingest/filters.test.ts`

**Step 1: Write failing tests**

captureLevelGate: drops user_prompt at metadata, allows tool_use at metadata, allows user_prompt at full.
classifySignificance: short prompt = low, file creation = high, test failure = high, long prompt = high.
shouldDedup: similar prompts within 5 min = merge, different timestamps = no merge.

**Step 2: Implement filters.ts**

Three exported functions matching the tests.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

Message: `feat: 3-level ingest filters for captureLevel, significance, dedup`

---

## Task 8: Ingest Pipeline Store Phase ✅ DONE

**Goal:** Redact, normalize, store in conversation_events + event_files + FTS. Delete processed files.
**Status:** Completed. 18 tests. 612/612 total tests pass. Typecheck OK. Biome OK.
**Note:** Pipeline now implements full 4-phase flow: Intake → Filter → Transform → Store. Added `filtered` field to IngestMetrics. Default captureLevel is 'metadata'. FTS content is built from event kind + payload text, redacted before indexing.

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`
- Modify: `packages/core/src/types.ts` (IngestMetrics + filtered field)
- Modify: `packages/core/src/storage/migrations.ts` (standalone FTS5)
- Test: `packages/core/tests/ingest/pipeline-store.test.ts`

**Step 1: Write failing tests**

After `processInbox()`: conversation_events row exists, event_files rows for each file path, conversation_fts MATCH finds event, secrets redacted in stored payload, processed JSON files deleted from inbox, correct metrics returned.

**Step 2: Implement store phase**

Import `redact()` from `security/redact.ts`. Write to conversation_events, event_files. Update FTS. Record in ingest_log. Delete inbox file. Return metrics.

**Step 3: Wire filters into pipeline**

Call captureLevelGate, classifySignificance before storing. Skip events that dont pass gate.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

Message: `feat: ingest pipeline store phase with redaction and FTS indexing`

---

## Task 9: Ingest Processing Policy

**Goal:** Wire inbox processing into MCP server (startup + before search + debounce).

**Files:**
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/integration/server.test.ts`

**Step 1: Compute inboxDir in createServer**

`const inboxDir = join(homedir(), '.claude', 'memory', 'locus-' + projectHash(root), 'inbox')`

**Step 2: Process inbox at startup**

After initStorage/runMigrations: `processInbox(inboxDir, db, config, { batchLimit: 0 })` (0 = unlimited).

**Step 3: Process inbox before memory_search**

Add `processInbox(inboxDir, db, config, { batchLimit: 50 })` call before handleSearch.

**Step 4: Store lastIngestMetrics for memory_status**

**Step 5: Test that server processes inbox at startup**

Write event file to inbox dir before createServer, verify row in DB after.

**Step 6: Commit**

Message: `feat: integrate ingest pipeline into MCP server lifecycle`

---

## Task 10: PostToolUse Hook Refactor

**Goal:** Refactor existing hook: inbox JSON files instead of direct SQLite.

**Files:**
- Modify: `packages/claude-code/hooks/post-tool-use.js`
- Modify: `packages/core/tests/hooks/post-tool-use.test.ts`

**Step 1: Write new test expectations**

After hook runs: JSON file in inbox dir (not DB row). Event follows InboxEvent schema. CaptureLevel gate applied before writing.

**Step 2: Refactor hook**

Remove all `openDb()`, `computeDbPath()`, SQLite code. Add `computeInboxDir(projectRoot)` returning `~/.claude/memory/locus-<hash>/inbox/`. Use `crypto.randomUUID()` for event_id. Write atomic JSON to inbox. Reuse existing `extractCapture`, `extractFilePaths`, `classifyError`.

**Step 3: Update existing tests**

Change assertions from DB rows to inbox files.

**Step 4: Run full suite**

**Step 5: Commit**

Message: `refactor: PostToolUse hook writes to inbox instead of direct SQLite`

---

## Task 11: UserPromptSubmit Hook

**Goal:** New hook capturing user prompts to inbox.

**Files:**
- Create: `packages/claude-code/hooks/user-prompt.js`
- Create: `packages/core/tests/hooks/user-prompt.test.ts`
- Modify: `hooks/hooks.json` and `packages/claude-code/hooks/hooks.json`

**Step 1: Write failing tests**

Writes user_prompt event at captureLevel=full. Does NOT write at metadata. Redacts secrets. Uses session_id from payload. Never crashes.

**Step 2: Implement user-prompt.js**

CaptureLevel gate first (metadata = skip). Use `crypto.randomUUID()`. Write atomic JSON. Reuse shared helpers (resolveProjectRoot, computeInboxDir) extracted from post-tool-use.js into shared module.

**Step 3: Update hooks.json files**

Add UserPromptSubmit matcher section.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

Message: `feat: add UserPromptSubmit hook for Carbon Copy prompt capture`

---

## Task 12: Stop Hook (Transcript Parser)

**Goal:** New hook parsing transcript JSONL for AI response capture.

**Files:**
- Create: `packages/claude-code/hooks/stop.js`
- Create: `packages/core/tests/hooks/stop.test.ts`
- Modify: hooks.json files

**Step 1: Write failing tests**

Parses JSONL, extracts last assistant message. Uses session cursor (tailer-state.json) to read only new lines. Writes at captureLevel=full, skips at metadata. Handles missing transcript_path. Handles malformed JSONL. Updates tailer-state.json.

**Step 2: Implement stop.js**

Read transcript_path from payload. Load tailer-state.json for last offset. Read new lines. Find assistant messages. Apply captureLevel gate. Write to inbox. Update state.

**Step 3: Update hooks.json files**

Add Stop matcher section.

**Step 4: Run tests, verify pass**

**Step 5: Run full suite**

**Step 6: Commit**

Message: `feat: add Stop hook with transcript parser for AI response capture`

---

## Task 13: Extended memory_search

**Goal:** Add optional timeRange, filePath, kind params. Backwards compatible.

**Files:**
- Modify: `packages/core/src/tools/search.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/tools/search.test.ts`

**Step 1: Write failing tests**

Finds conversation events by FTS5. Filters by timeRange.relative. Filters by filePath (JOIN event_files). Filters by kind. Combines filters. Backwards compat: query-only works. Per-layer results. bm25 + recency scoring.

**Step 2: Add searchConversation function**

New function alongside searchStructural and searchEpisodic. Queries conversation_events + conversation_fts + event_files.

**Step 3: Compute timeRange server-side**

`resolveTimeRange(range)`: convert relative strings to from/to using local timezone.

**Step 4: Update Zod schema in server.ts**

Add optional timeRange, filePath, kind, source, limit, offset params to memory_search tool.

**Step 5: Run tests, verify pass + existing search tests pass**

**Step 6: Commit**

Message: `feat: extend memory_search with timeRange, filePath, kind filters`

---

## Task 14: Enhanced locus://recent

**Goal:** Show conversation event stats with captureLevel gate.

**Files:**
- Modify: `packages/core/src/resources/recent.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/resources/recent.test.ts`

**Step 1: Write failing tests**

Shows recent files from conversation_events. Shows event counts. At full: shows last 3 prompts. At metadata: no prompts. Hard limit 5. No AI responses. Within 1000 token budget. Backwards compat with episodic sessions.

**Step 2: Implement**

Add conversation stats section. Pass captureLevel to function. Query conversation_events for recent files/counts/prompts.

**Step 3: Update server.ts to pass captureLevel**

**Step 4: Run tests, verify pass**

**Step 5: Commit**

Message: `feat: enhance locus://recent with conversation event stats`

---

## Task 15: memory_timeline Tool (Should)

**Goal:** Chronological event feed with summary mode.

**Files:**
- Create: `packages/core/src/tools/timeline.ts`
- Test: `packages/core/tests/tools/timeline.test.ts`
- Modify: `packages/core/src/server.ts`

**Step 1: Write failing tests**

Chronological order. Filters by timeRange, kind, filePath. Summary mode = headers only. Default limit 20. Empty when no match.

**Step 2: Implement timeline.ts**

**Step 3: Register in server.ts with Zod schema**

**Step 4: Commit**

Message: `feat: add memory_timeline tool for chronological event feed`

---

## Task 16: memory_status Update

**Goal:** Add inbox metrics to status.

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/tools/status.test.ts`

**Step 1: Extend MemoryStatus type**

Add totalConversationEvents, inboxPending.

**Step 2: Update handleStatus**

Query conversation_events count. Count inbox files.

**Step 3: Commit**

Message: `feat: add conversation event metrics to memory_status`

---

## Task 17: Integration Tests

**Goal:** End-to-end Carbon Copy flow test.

**Files:**
- Create: `packages/core/tests/integration/carbon-copy.test.ts`

**Step 1: Write E2E tests**

Full flow: inbox event to ingest to search. CaptureLevel=metadata blocks prompts. Duplicate events not stored twice. Secrets redacted in stored payload.

**Step 2: Run full suite**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

Message: `test: add Carbon Copy end-to-end integration tests`

---

## Task 18: Version Bump and README

**Goal:** Update to v3.0.0, document new features.

**Files:**
- Modify: `package.json`, `packages/core/package.json`, `.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Bump versions to 3.0.0**

**Step 2: Update README**

Add Carbon Copy feature description, captureLevel docs, new tools, extended search params.

**Step 3: Final check**

Run: `npm run check`
Expected: typecheck + lint + all tests pass.

**Step 4: Commit**

Message: `docs: update README for v3.0.0, bump version`

---

## Summary

| Task | Component | Type | Priority |
|------|-----------|------|----------|
| 1 | Monorepo scaffold | Refactor | Must |
| 2 | Compat shims | Feature | Must |
| 3 | Conversation event types | Feature | Must |
| 4 | DB migration v2 | Feature | Must |
| 5 | Inbox writer utility | Feature | Must |
| 6 | Ingest pipeline (intake + dedup) | Feature | Must |
| 7 | Ingest filters (3-level) | Feature | Must |
| 8 | Ingest pipeline (store) | Feature | Must |
| 9 | Ingest processing policy | Feature | Must |
| 10 | PostToolUse hook refactor | Refactor | Must |
| 11 | UserPromptSubmit hook | Feature | Must |
| 12 | Stop hook (transcript parser) | Feature | Must |
| 13 | Extended memory_search | Feature | Must |
| 14 | Enhanced locus://recent | Feature | Must |
| 15 | memory_timeline (Should) | Feature | Should |
| 16 | memory_status update | Feature | Must |
| 17 | Integration tests | Test | Must |
| 18 | Version bump and README | Docs | Must |

**Dependency graph:**

```
1 (monorepo) --> 2 (shims) --> 3 (types) --> 4 (migration)
                                                  |
                                            5 (inbox writer)
                                                  |
                                   6 (pipeline intake + dedup)
                                                  |
                          +----------+------------+----------+
                          |          |                       |
                    7 (filters)    10 (hook refactor)       |
                          |        11 (prompt hook)         |
                          |        12 (stop hook)           |
                          +----------+----------+-----------+
                                     |
                              8 (pipeline store)
                                     |
                              9 (processing policy)
                                     |
                   +---------+-------+---------+
                   |         |       |         |
             13 (search) 14 (recent) 15 (timeline) 16 (status)
                   |         |       |         |
                   +---------+-------+---------+
                                     |
                              17 (integration)
                                     |
                              18 (version + docs)
```

**Parallelizable after Task 6:**
- Tasks 7, 10, 11, 12 can run in parallel
- Tasks 13, 14, 15, 16 can run in parallel after Task 8
