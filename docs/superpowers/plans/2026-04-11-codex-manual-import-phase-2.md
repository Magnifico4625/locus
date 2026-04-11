# Codex Manual Import Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Codex session import as a first-class MCP tool so Codex users can import rollout JSONL history into Locus on demand and search it immediately.

**Architecture:** `packages/codex` remains the Codex-specific adapter and gains filter-aware import options plus an optional "already ingested" skip callback. `packages/core` adds a new MCP tool `memory_import_codex` that calls the Codex importer, writes to the existing inbox, immediately runs `processInbox()`, and returns a stable JSON result contract. Phase 2 must not introduce auto-import logic, must not change Claude Code behavior, and must keep the adapter-to-core boundary one-way.

**Tech Stack:** Node.js 22+, TypeScript, ESM, Vitest, MCP SDK, Zod, npm workspaces, existing `InboxEvent v1` + `processInbox()` pipeline.

---

## Scope

In scope:

- `memory_import_codex` MCP tool in `packages/core`
- filter-aware Codex importer options
- immediate ingest after import so results are searchable right away
- stable tool response metrics
- repeated-call dedup behavior
- docs for the new tool

Out of scope:

- auto-import before `memory_search` (Phase 3)
- `memory_status` / `memory_doctor` Codex diagnostics (Phase 5)
- skill behavior changes (Phase 4)
- plugin packaging (Phase 7)
- any Claude Code hook behavior changes

## File Structure

Create:

- `packages/core/src/tools/import-codex.ts`
- `packages/core/tests/tools/import-codex.test.ts`
- `packages/core/tests/integration/codex-import-tool.test.ts`

Modify:

- `packages/core/package.json`
- `packages/core/src/server.ts`
- `packages/core/src/types.ts`
- `packages/codex/src/importer.ts`
- `packages/codex/src/types.ts`
- `packages/codex/tests/importer.test.ts`
- `packages/codex/README.md`
- `README.md`
- `docs/roadmap/codex.md`

Do not modify:

- `packages/claude-code/**`
- `claude-code/hooks/**`

## Public Contract

`memory_import_codex` should return one JSON object with this stable shape:

```json
{
  "status": "ok",
  "captureMode": "metadata",
  "imported": 12,
  "skipped": 3,
  "duplicates": 5,
  "errors": 0,
  "filesScanned": 2,
  "latestSession": "session_abc",
  "processed": 12,
  "remaining": 0,
  "message": "Imported 12 Codex events into memory."
}
```

When `LOCUS_CODEX_CAPTURE=off`, return a non-error response:

```json
{
  "status": "disabled",
  "captureMode": "off",
  "imported": 0,
  "skipped": 0,
  "duplicates": 0,
  "errors": 0,
  "filesScanned": 0,
  "message": "Codex import is disabled by LOCUS_CODEX_CAPTURE=off."
}
```

Supported tool params:

- `latestOnly?: boolean`
- `projectRoot?: string`
- `sessionId?: string`
- `since?: number`

Semantics:

- `imported` = events from the current `memory_import_codex` run that are actually accepted into storage after `processInbox()`, not just written to inbox
- `duplicates` = events skipped because they are already ingested or already pending in inbox
- `skipped` = events ignored due to capture mode, unknown record type, or filters
- `errors` = file read, parse, write, or ingest failures; `parseErrors` from the Codex importer must be included in this final number

---

## Tasks

### Task 0: Branch And Phase 1 Checkpoint

**Files:** none

- [ ] Verify clean baseline: `git status --short --branch`
- [ ] Verify current checkpoint tag exists: `git tag --list codex-jsonl-phase-1-local`
- [ ] Create Phase 2 branch from the stable checkpoint:

```bash
git checkout codex-jsonl-phase-1-local
git checkout -b feature/codex-manual-import
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `9a440d0 chore(codex): complete phase 1 validation` is at or near `HEAD`.

### Task 1: Define Core Tool Result Types

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/tools/import-codex.test.ts`

- [ ] Add result types in `packages/core/src/types.ts`:
  - `MemoryImportCodexResponseOk`
  - `MemoryImportCodexResponseDisabled`
  - `MemoryImportCodexResponseError`
  - union `MemoryImportCodexResponse`
- [ ] Create `packages/core/tests/tools/import-codex.test.ts`
- [ ] Write the first failing test for disabled mode response shape.
- [ ] Run the single test:

```bash
npm test -- packages/core/tests/tools/import-codex.test.ts
```

Expected: FAIL because handler does not exist yet.

- [ ] Commit scaffolding:

```bash
git add packages/core/src/types.ts packages/core/tests/tools/import-codex.test.ts
git commit -m "test(core): add codex import response contract"
```

### Task 2: Add Filter-Aware Codex Import Options

**Files:**
- Modify: `packages/codex/src/types.ts`
- Modify: `packages/codex/src/importer.ts`
- Modify: `packages/codex/tests/importer.test.ts`

- [ ] Extend importer options in `packages/codex/src/types.ts` or `importer.ts`:
  - `latestOnly?: boolean`
  - `projectRoot?: string`
  - `sessionId?: string`
  - `since?: number`
  - `shouldSkipEventId?: (eventId: string) => boolean`
- [ ] Extend importer metrics so they can be collapsed cleanly into:
  - `imported`
  - `skipped`
  - `duplicates`
  - `errors`
  - `filesScanned`
  - `latestSession`
- [ ] Make `latestSession` deterministic across the whole import run:
  - track one global max timestamp across all files/events in scope
  - do not reset that max timestamp per file or per helper call
  - when `latestOnly=true`, `latestSession` must still reflect the newest imported session in that filtered scope
- [ ] Add failing tests in `packages/codex/tests/importer.test.ts` for:
  - `latestOnly` imports only newest rollout file
  - `sessionId` keeps one session
  - `since` ignores older events
  - `projectRoot` filters mismatched project roots
  - `latestSession` reflects the session with the maximum event timestamp across all scanned files
- [ ] Run targeted tests:

```bash
npm test -- packages/codex/tests/importer.test.ts
```

Expected: FAIL on new filter cases.

- [ ] Implement the minimal importer changes to pass those cases.
- [ ] Re-run targeted tests until green.
- [ ] Commit:

```bash
git add packages/codex/src/types.ts packages/codex/src/importer.ts packages/codex/tests/importer.test.ts
git commit -m "feat(codex): add filtered import options"
```

### Task 3: Add Already-Ingested Dedup Hook

**Files:**
- Modify: `packages/codex/src/importer.ts`
- Modify: `packages/codex/tests/importer.test.ts`

- [ ] Add a failing importer test showing `shouldSkipEventId()` increments duplicates and avoids writing inbox files.
- [ ] Run:

```bash
npm test -- packages/codex/tests/importer.test.ts
```

Expected: FAIL on duplicate-skip callback behavior.

- [ ] Implement callback-based skip before inbox write.
- [ ] Keep existing pending-file duplicate protection unchanged.
- [ ] Re-run targeted tests.
- [ ] Commit:

```bash
git add packages/codex/src/importer.ts packages/codex/tests/importer.test.ts
git commit -m "feat(codex): skip already ingested event ids"
```

### Task 4: Add Core Import Handler

**Files:**
- Create: `packages/core/src/tools/import-codex.ts`
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/tools/import-codex.test.ts`

- [ ] Implement a pure handler function in `packages/core/src/tools/import-codex.ts`, for example:
  - inputs: tool params + deps (`db`, `inboxDir`, `captureLevel`, `env`, `processInbox`, `importCodexSessionsToInbox`)
  - outputs: `MemoryImportCodexResponse`
- [ ] Handler responsibilities:
  - resolve `LOCUS_CODEX_CAPTURE`
  - return `"disabled"` when capture is `off`
  - compute already-ingested `event_id` set from `ingest_log` with one bulk read before import, then use an in-memory `Set<string>` for `shouldSkipEventId`
  - call the Codex importer with filters and `shouldSkipEventId`
  - run `processInbox()` immediately after successful writes
  - collapse raw importer + ingest metrics into the public response
  - calculate `imported` from events of the current run that actually reached `ingest_log` / storage after `processInbox()`, not by blindly returning importer `written` and not by blindly returning total `processInbox().processed`
- [ ] Write failing handler tests in `packages/core/tests/tools/import-codex.test.ts` for:
  - disabled mode
  - importer metrics mapping
  - duplicate counting from `shouldSkipEventId`
  - no-write / no-process behavior when importer returns zero writes
  - final `errors` includes importer `parseErrors`
  - final `imported` reflects only current-run events accepted into storage
- [ ] Run:

```bash
npm test -- packages/core/tests/tools/import-codex.test.ts
```

Expected: FAIL until handler is implemented.

- [ ] Implement minimal code to make the tests pass.
- [ ] Re-run targeted tests.
- [ ] Commit:

```bash
git add packages/core/src/tools/import-codex.ts packages/core/src/types.ts packages/core/tests/tools/import-codex.test.ts
git commit -m "feat(core): add codex import handler"
```

### Task 5: Wire `@locus/codex` Into Core

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/server.ts`

- [ ] Add workspace dependency on `@locus/codex` in `packages/core/package.json`.
- [ ] Import the Codex importer and new handler in `packages/core/src/server.ts`.
- [ ] Register MCP tool:
  - name: `memory_import_codex`
  - params: `latestOnly`, `projectRoot`, `sessionId`, `since`
  - output: `JSON.stringify(result)`
- [ ] Keep the tool registration near other memory tools, not in a Codex-only side file.
- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/package.json packages/core/src/server.ts
git commit -m "feat(core): expose memory_import_codex tool"
```

### Task 6: Integration Test For Immediate Searchability

**Files:**
- Create: `packages/core/tests/integration/codex-import-tool.test.ts`

- [ ] Create an integration test that:
  - builds a temp server with temp DB/inbox
  - creates a temp Codex sessions tree with rollout JSONL fixtures
  - runs the import handler or tool path
  - verifies imported data lands in SQLite
  - verifies `handleSearch()` can find imported content immediately
- [ ] Add a second integration case for repeated import:
  - first call imports data
  - second call reports duplicates and does not increase conversation row count
- [ ] Run:

```bash
npm test -- packages/core/tests/integration/codex-import-tool.test.ts
```

Expected: FAIL before the integration path is complete.

- [ ] Make only the minimal code changes needed for green tests.
- [ ] Re-run the integration suite.
- [ ] Commit:

```bash
git add packages/core/tests/integration/codex-import-tool.test.ts
git commit -m "test(core): cover codex import integration"
```

### Task 7: Server Regression Coverage

**Files:**
- Modify: `packages/core/tests/integration/server.test.ts`

- [ ] Add one focused regression test in `packages/core/tests/integration/server.test.ts` proving `createServer()` still initializes cleanly with the new tool code path present.
- [ ] Keep this test small: do not duplicate the integration suite from Task 6.
- [ ] Run:

```bash
npm test -- packages/core/tests/integration/server.test.ts
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/tests/integration/server.test.ts
git commit -m "test(core): keep server stable with codex import tool"
```

### Task 8: Documentation Update

**Files:**
- Modify: `packages/codex/README.md`
- Modify: `README.md`
- Modify: `docs/roadmap/codex.md`

- [ ] Update `packages/codex/README.md`:
  - Phase 1 note becomes historical
  - show `memory_import_codex` usage example
  - explain filters and capture behavior
- [ ] Update `README.md`:
  - Codex CLI section should say passive import is now available manually
  - add `memory_import_codex` to tools reference
  - keep auto-import marked as future work
- [ ] Update `docs/roadmap/codex.md`:
  - mark Phase 2 as implemented only when code/tests are green
  - set Phase 3 as next step
- [ ] Run docs sanity search:

```bash
rg -n "planned for v3.2|memory_import_codex|Passive conversation capture requires a Codex adapter" README.md packages/codex/README.md docs/roadmap/codex.md
```

- [ ] Commit:

```bash
git add packages/codex/README.md README.md docs/roadmap/codex.md
git commit -m "docs(codex): document manual import tool"
```

### Task 9: Full Validation And Phase 2 Checkpoint

**Files:** all modified files

- [ ] Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] Run:

```bash
npm test
```

Expected: PASS.

- [ ] Run:

```bash
npm run build
```

Expected: PASS.

- [ ] Review final branch diff:

```bash
git diff --stat codex-jsonl-phase-1-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-jsonl-phase-1-local..HEAD
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-manual-import-phase-2-local -m "Codex manual import phase 2 local checkpoint"
```

- [ ] Final checkpoint commit if needed:

```bash
git commit -m "chore(codex): complete phase 2 validation"
```

---

## Risk Controls

- Keep the adapter boundary one-way: `packages/core` can depend on `@locus/codex`, but `packages/codex` must not runtime-import core.
- Repeated imports must not create repeated stored conversation rows; use `ingest_log`-backed skip logic with one bulk load into an in-memory `Set`, not per-event SQL.
- `LOCUS_CODEX_CAPTURE=off` is not an error; it is an explicit no-op state.
- Do not bundle auto-import logic into Phase 2.
- Do not modify Claude hooks or Claude-specific tests beyond repo-wide formatting if absolutely required.
- `latestOnly` must be deterministic; rely on the already sorted rollout file list.
- `latestSession` must be based on the maximum event timestamp in the filtered import scope, not on traversal order alone.
- The final public `imported` metric must describe successful storage outcome for this run, not just inbox writes.

## Manual Verification

After automated validation, run one local smoke test in Codex CLI:

```bash
codex
```

Then call:

```text
memory_import_codex({"latestOnly":true})
memory_search({"query":"<known text from imported Codex session>"})
```

Expected:

- first tool returns non-zero `imported` or non-zero `duplicates`
- second tool can find imported conversation data when capture mode allows it

## Execution Notes

- Execute locally first on `feature/codex-manual-import`.
- Keep commits atomic by task.
- If Codex JSONL shape in real sessions differs from fixtures, update fixtures and importer tests before touching core tool logic.
- If the MCP tool return contract needs to change, update docs and tests in the same task; do not let them drift.
