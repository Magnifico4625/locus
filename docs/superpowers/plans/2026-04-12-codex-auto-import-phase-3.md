# Codex Auto Import Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex memory feel persistent by auto-importing the newest Codex rollout session before `memory_search`, without requiring manual import on every search.

**Architecture:** Phase 3 must reuse the Phase 2 import path instead of creating a second importer. `packages/core` adds a thin auto-import coordinator that detects Codex, applies a bounded debounce policy, calls the existing `handleImportCodex({ latestOnly: true })`, and records a small status snapshot for `memory_status`. Search must remain best-effort: auto-import failures never block results, and Claude Code behavior must remain unchanged.

**Tech Stack:** Node.js 22+, TypeScript, ESM, Vitest, MCP SDK, Zod, npm workspaces, existing `@locus/codex` importer, existing `handleImportCodex()` + `processInbox()` pipeline.

---

## Scope

In scope:

- Codex-only auto-import on the `memory_search` tool path
- debounce for repeated searches
- bounded import scope via `latestOnly: true`
- best-effort behavior when import fails
- last auto-import status surfaced in `memory_status`
- docs for the new behavior

Out of scope:

- background watcher / daemon / scheduler
- auto-import on every MCP tool
- new Codex doctor checks (Phase 5)
- skill behavior changes (Phase 4)
- plugin packaging
- any Claude Code hook changes
- new environment toggle for auto-import in Phase 3

## Design Decisions

- Reuse `handleImportCodex()` as the single source of truth for Codex import semantics.
- Auto-import runs only when Codex is the detected client environment.
- Auto-import uses `latestOnly: true` to keep search latency bounded.
- Auto-import debounce is explicit and local to the server process: `45_000ms`.
- `LOCUS_CODEX_CAPTURE=off` remains the master kill switch. Phase 3 does not introduce a separate auto-import env toggle.
- `memory_status` is the Phase 3 surface for last import state; `memory_config` stays unchanged.
- Search continues even if auto-import returns `error`, `disabled`, or throws internally.

## File Structure

Create:

- `packages/core/src/tools/auto-import-codex.ts`
- `packages/core/tests/tools/auto-import-codex.test.ts`
- `packages/core/tests/integration/codex-auto-import-search.test.ts`

Modify:

- `packages/core/src/server.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/types.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/integration/server.test.ts`
- `README.md`
- `packages/codex/README.md`
- `docs/roadmap/codex.md`

Do not modify:

- `packages/claude-code/**`
- `packages/codex/src/importer.ts`
- `packages/core/src/tools/import-codex.ts` unless a test proves a shared contract gap

## Public Contract

Phase 3 extends `memory_status` with a Codex auto-import snapshot. Recommended shape:

```json
{
  "codexAutoImport": {
    "clientDetected": true,
    "debounceMs": 45000,
    "lastStatus": "imported",
    "lastAttemptAt": 1760000000000,
    "lastRunAt": 1760000000000,
    "lastImported": 4,
    "lastDuplicates": 0,
    "lastErrors": 0,
    "latestSession": "sess_basic_001",
    "message": "Imported 4 Codex events into memory."
  }
}
```

Allowed `lastStatus` values:

- `idle`
- `skipped_not_codex`
- `debounced`
- `disabled`
- `imported`
- `duplicates_only`
- `error`

`memory_search` response shape does not change in Phase 3.

## Search Semantics

Before the actual search query runs:

1. If client is not Codex, keep existing pre-search inbox processing behavior only.
2. If client is Codex and debounce has not expired, skip auto-import and continue to search immediately.
3. If client is Codex and debounce has expired:
   - call `handleImportCodex({ latestOnly: true }, ...)`
   - never throw past the search handler
   - update `codexAutoImport` state
4. After that:
   - if Codex auto-import already processed inbox, do not immediately call generic `processInbox()` again
   - if Codex auto-import did not process inbox, existing generic inbox processing may still run under the normal ingest debounce policy

This preserves Codex auto-import while keeping the generic inbox path intact for other pending event sources.

## Risk Controls

- Do not duplicate import logic already implemented in `handleImportCodex()`.
- Do not auto-import the full Codex session history on every search; Phase 3 uses `latestOnly: true`.
- Do not let auto-import errors block `memory_search`.
- Do not change search result ranking or response shape.
- Do not regress non-Codex search behavior.
- Do not surface Codex auto-import state through ad-hoc logs only; it must be visible in `memory_status`.
- Keep server-local debounce state simple and explicit; no persistent scheduler state in SQLite for Phase 3.

### Task 0: Branch From Phase 2 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree on the current branch.

- [ ] Verify Phase 2 checkpoint tag exists:

```bash
git tag --list codex-manual-import-phase-2-local
```

Expected: prints `codex-manual-import-phase-2-local`.

- [ ] Create the Phase 3 branch from the stable checkpoint:

```bash
git checkout codex-manual-import-phase-2-local
git checkout -b feature/codex-auto-import
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `2793212 chore(codex): complete phase 2 validation` at or near `HEAD`.

### Task 1: Define Auto-Import State Types

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/tools/status.test.ts`

- [ ] Add types in `packages/core/src/types.ts`:
  - `CodexAutoImportStatus`
  - `CodexAutoImportSnapshot`
  - extend `MemoryStatus` with optional or required `codexAutoImport`

- [ ] Keep the snapshot compact:
  - `clientDetected: boolean`
  - `debounceMs: number`
  - `lastStatus`
  - `lastAttemptAt?: number`
  - `lastRunAt?: number`
  - `lastImported: number`
  - `lastDuplicates: number`
  - `lastErrors: number`
  - `latestSession?: string`
  - `message?: string`

- [ ] Add a failing `memory_status` test showing the new field shape.

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/status.test.ts
```

Expected: FAIL because the status shape does not include Codex auto-import info yet.

- [ ] Commit:

```bash
git add packages/core/src/types.ts packages/core/tests/tools/status.test.ts
git commit -m "test(core): define codex auto import status shape"
```

### Task 2: Add Pure Codex Auto-Import Coordinator

**Files:**
- Create: `packages/core/src/tools/auto-import-codex.ts`
- Test: `packages/core/tests/tools/auto-import-codex.test.ts`

- [ ] Create a pure coordinator that wraps Phase 2 import behavior, for example:
  - input: current snapshot, `now`, server deps, `handleImportCodex`, `detectClientEnv`
  - output: `{ snapshot, ranImport, processedInbox }`

- [ ] Coordinator rules:
  - if detected client is not Codex: set `lastStatus='skipped_not_codex'`
  - if within debounce window: set `lastStatus='debounced'`
  - if Codex import returns `disabled`: set `lastStatus='disabled'`
  - if Codex import returns `ok` with `imported > 0`: set `lastStatus='imported'`
  - if Codex import returns `ok` with `duplicates > 0` and `imported === 0`: set `lastStatus='duplicates_only'`
  - if Codex import returns `error` or throws: set `lastStatus='error'`

- [ ] Hardcode Phase 3 policy in this helper:
  - `latestOnly: true`
  - debounce `45_000ms`

- [ ] Write failing tests for:
  - non-Codex environment skips import
  - debounce suppresses repeated import
  - success updates snapshot from import result
  - duplicates-only result is not treated as error
  - thrown import error is swallowed into snapshot and returned as best-effort failure

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/auto-import-codex.test.ts
```

Expected: FAIL until the coordinator exists.

- [ ] Implement the minimal coordinator to pass the tests.

- [ ] Re-run targeted tests until green.

- [ ] Commit:

```bash
git add packages/core/src/tools/auto-import-codex.ts packages/core/tests/tools/auto-import-codex.test.ts
git commit -m "feat(core): add codex auto import coordinator"
```

### Task 3: Wire Auto-Import Into `memory_search`

**Files:**
- Modify: `packages/core/src/server.ts`

- [ ] Replace the inline pre-search logic in `memory_search` with a two-stage flow:
  - run Codex auto-import coordinator first
  - then run generic `processInbox()` only if the coordinator did not already process inbox

- [ ] Reuse existing imports:
  - `handleImportCodex`
  - `importCodexSessionsToInbox`
  - `processInbox`
  - `@locus/shared-runtime` `detectClientEnv`

- [ ] Keep server-local state in closures near existing ingest state:
  - existing `_lastIngestMetrics`
  - existing `lastIngestTime`
  - new `codexAutoImportSnapshot`

- [ ] Do not change `handleSearch()` itself. Phase 3 belongs on the tool/server layer, not in the pure search function.

- [ ] Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/src/server.ts
git commit -m "feat(core): trigger codex auto import before search"
```

### Task 4: Integration Coverage For Search-Time Auto Import

**Files:**
- Create: `packages/core/tests/integration/codex-auto-import-search.test.ts`

- [ ] Add an integration case that:
  - creates temp `CODEX_HOME/sessions`
  - creates a temp server
  - does not call `memory_import_codex`
  - calls the same search path used by the server tool
  - verifies Codex conversation content is searchable after search-triggered auto-import

- [ ] Add a second integration case that:
  - runs search twice within the debounce window
  - verifies conversation row count does not grow on the second call
  - verifies the second call still returns search results

- [ ] Add a third integration case that:
  - forces the Codex import path to fail
  - verifies search still returns structural or semantic results instead of failing

- [ ] Run:

```bash
npm test -- packages/core/tests/integration/codex-auto-import-search.test.ts
```

Expected: FAIL before server wiring is complete.

- [ ] Make only the minimal code changes needed for green tests.

- [ ] Re-run the integration suite.

- [ ] Commit:

```bash
git add packages/core/tests/integration/codex-auto-import-search.test.ts packages/core/src/server.ts
git commit -m "test(core): cover codex auto import search flow"
```

### Task 5: Surface Last Auto-Import Status In `memory_status`

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/tools/status.test.ts`

- [ ] Extend `handleStatus()` dependencies to accept the current `codexAutoImportSnapshot`.

- [ ] Return the snapshot in `MemoryStatus`.

- [ ] Keep status behavior stable for non-Codex clients:
  - `clientDetected=false`
  - `lastStatus='idle'` or `skipped_not_codex`
  - zeroed counters

- [ ] Add / update tests proving:
  - status includes `codexAutoImport`
  - last import values are surfaced correctly
  - non-Codex default status stays well-defined

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/status.test.ts
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/src/tools/status.ts packages/core/src/types.ts packages/core/src/server.ts packages/core/tests/tools/status.test.ts
git commit -m "feat(core): expose codex auto import status"
```

### Task 6: Server Regression Coverage

**Files:**
- Modify: `packages/core/tests/integration/server.test.ts`

- [ ] Add one focused regression test proving `createServer()` still initializes cleanly with the Phase 3 Codex auto-import state present.

- [ ] Add one small regression case proving non-Codex startup/search paths do not require `CODEX_HOME`.

- [ ] Keep this suite small. Do not duplicate Task 4 integration scenarios.

- [ ] Run:

```bash
npm test -- packages/core/tests/integration/server.test.ts
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/tests/integration/server.test.ts
git commit -m "test(core): keep server stable with codex auto import"
```

### Task 7: Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `docs/roadmap/codex.md`

- [ ] Update `README.md`:
  - Codex section should say recent rollout history is auto-imported before `memory_search`
  - keep `memory_import_codex` documented for manual catch-up / explicit control
  - describe bounded behavior: newest rollout only, debounced, best-effort

- [ ] Update `packages/codex/README.md`:
  - explain manual import vs auto-import roles
  - clarify that auto-import is search-triggered, not a background watcher
  - mention `LOCUS_CODEX_CAPTURE=off` disables both manual and auto Codex import behavior

- [ ] Update `docs/roadmap/codex.md`:
  - mark Phase 3 implemented only after tests are green
  - set Phase 4 as the next step

- [ ] Run docs sanity search:

```bash
rg -n "auto-import before search|memory_import_codex|latestOnly|LOCUS_CODEX_CAPTURE" README.md packages/codex/README.md docs/roadmap/codex.md
```

- [ ] Commit:

```bash
git add README.md packages/codex/README.md docs/roadmap/codex.md
git commit -m "docs(codex): describe auto import before search"
```

### Task 8: Full Validation And Phase 3 Checkpoint

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
git diff --stat codex-manual-import-phase-2-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-manual-import-phase-2-local..HEAD
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-auto-import-phase-3-local -m "Codex auto import phase 3 local checkpoint"
```

- [ ] Final checkpoint commit if needed:

```bash
git commit -m "chore(codex): complete phase 3 validation"
```

---

## Manual Verification

After automated validation, run one local smoke test in Codex CLI:

```bash
codex
```

Then call:

```text
memory_search({"query":"<known text from newest Codex rollout>"})
memory_status({})
```

Expected:

- search returns Codex conversation results without calling `memory_import_codex` first
- `memory_status` shows a populated `codexAutoImport` snapshot
- repeated search within ~45 seconds does not re-import the same latest rollout again

## Notes For Execution

- If a reviewer suggests adding a second auto-import implementation path, reject that suggestion unless a concrete Phase 2 gap is demonstrated by tests.
- If a reviewer suggests background watchers, defer that to a future phase; it is intentionally out of scope here.
- If full `npm test` shows timeouts under parallel local validation, rerun `npm test` serially and document that the failure was caused by validation strategy rather than by product code.
