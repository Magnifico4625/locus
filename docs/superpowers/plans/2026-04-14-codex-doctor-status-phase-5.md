# Codex Doctor And Status Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex memory support diagnosable through `memory_doctor` and `memory_status` without changing Claude Code behavior or the Codex ingest pipeline.

**Architecture:** Add a small shared Codex diagnostics snapshot helper inside `packages/core` that reads Codex session discovery state from `@locus/codex` and Codex import state from the existing SQLite tables. `memory_status` should expose the snapshot as structured data, and `memory_doctor` should turn the same snapshot into actionable user-facing checks only when Codex is actually configured.

**Tech Stack:** Node.js 22+, TypeScript, Vitest, SQLite (`node:sqlite`/`sql.js`), MCP server tools, `@locus/codex` session path helpers.

---

## Scope

In scope:

- extend `memory_status` with Codex-specific diagnostic state
- extend `memory_doctor` with Codex checks when `CODEX_HOME` is present
- reuse existing Codex path helpers from `@locus/codex`
- surface imported Codex event counts and most recent imported session timestamp from existing DB tables
- add docs for common Codex diagnosis/fix flows

Out of scope:

- any changes to Codex JSONL parsing/import semantics
- any changes to search-time auto-import behavior
- any `packages/claude-code/**` changes
- new env flags
- IDE/plugin packaging work

## Design Decisions

- Keep Phase 5 diagnostic-only. Do not change importer behavior to “fix” issues automatically.
- Add one shared structured helper in `packages/core`, rather than duplicating FS/DB logic across `status.ts` and `doctor.ts`.
- Reuse `resolveCodexSessionsDir()` and `findCodexRolloutFiles()` from `@locus/codex` instead of re-implementing session discovery in core.
- `memory_status` should expose Codex diagnostics as structured JSON, but only when Codex is configured; generic clients should stay quiet.
- `memory_doctor` should append Codex-specific checks only when `CODEX_HOME` is present, matching the roadmap promise exactly.
- Use DB truth for import state:
  - imported Codex event count should come from `ingest_log` rows with `source='codex'`
  - latest imported timestamp/session comes from the latest stored Codex conversation event
- Reuse the existing Codex rollout discovery ordering:
  - latest rollout file should be derived from `findCodexRolloutFiles(...)` ordering, not filesystem `mtime`
- Latest rollout readability should be checked with a lightweight open/close probe, not by loading the whole file into memory.
- Treat `LOCUS_CODEX_CAPTURE=off` as diagnosable configuration, not as a failure.
- Do not promise that VS Code/IDE MCP visibility issues can be repaired by the repo; docs should keep the upstream boundary explicit.

## File Structure

Create:

- `packages/core/src/tools/codex-diagnostics.ts`
- `packages/core/tests/tools/codex-diagnostics.test.ts`

Modify:

- `packages/core/src/types.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/tools/doctor.ts`
- `packages/core/src/server.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/tools/doctor.test.ts`
- `packages/core/tests/integration/server.test.ts`
- `README.md`
- `packages/codex/README.md`
- `docs/roadmap/codex.md`

Do not modify:

- `packages/codex/src/importer.ts`
- `packages/claude-code/**`
- `dist/**` until final validation

## Public Contract

Phase 5 should make the following true:

- `memory_status` can tell a Codex user:
  - which capture mode is active
  - which sessions directory is being inspected
  - whether it exists
  - how many rollout files were found
  - whether the latest rollout file is readable
  - how many Codex events are already imported
  - when the latest imported Codex session/event was stored
- `memory_doctor` can explain the most common reasons Codex memory is absent:
  - wrong/missing `CODEX_HOME`
  - missing `sessions/`
  - no rollout files yet
  - unreadable rollout file
  - capture mode disabled
  - zero imported Codex events so far
- non-Codex clients do not get noisy Codex diagnostics by default

## Compatibility Position

- **Codex CLI:** Phase 5 should make local diagnosis first-class through `memory_status` and `memory_doctor`.
- **Codex VS Code extension:** diagnostics can confirm local Locus/Codex state, but cannot guarantee upstream MCP tool visibility inside the extension.
- **Other MCP IDEs:** generic memory tools continue to work; Codex-specific diagnostics appear only when Codex configuration is actually present.

## Risk Controls

- Do not query the filesystem separately in both `status.ts` and `doctor.ts`; that invites semantic drift.
- Do not make `memory_status` always emit Codex noise for generic clients.
- Do not infer imported Codex counts from inbox files; use persisted DB truth.
- Prefer `ingest_log` for Codex import counts because `conversation_events(source)` is not currently indexed.
- Do not mark `LOCUS_CODEX_CAPTURE=off` as a hard failure; it is a valid but intentionally disabled state.
- Do not introduce any write side effects into Phase 5 diagnostics.
- Keep doctor fixes actionable and local, not vague.

### Task 0: Branch From The Phase 4 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree.

- [ ] Verify Phase 4 checkpoint tag exists:

```bash
git tag --list codex-skill-upgrade-phase-4-local
```

Expected: prints `codex-skill-upgrade-phase-4-local`.

- [ ] Create the Phase 5 branch from the stable checkpoint:

```bash
git checkout codex-skill-upgrade-phase-4-local
git checkout -b feature/codex-doctor-status
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `38300b7 chore(codex): complete phase 4 validation` at or near `HEAD`.

### Task 1: Lock The Codex Diagnostic Contract With Failing Tests

**Files:**
- Create: `packages/core/tests/tools/codex-diagnostics.test.ts`
- Modify: `packages/core/tests/tools/status.test.ts`
- Modify: `packages/core/tests/tools/doctor.test.ts`

- [ ] Add failing unit tests for a new Codex diagnostics snapshot helper that assert:
  - no snapshot is returned when `CODEX_HOME` is absent
  - `sessionsDir` resolves from `CODEX_HOME`
  - missing `sessionsDir` is represented explicitly
  - rollout file count and latest rollout metadata are returned
  - Codex import counters are read from DB rows where `source='codex'`
  - latest imported timestamp/session is derived from persisted Codex conversation rows

- [ ] Add failing `status.test.ts` coverage that expects a structured Codex diagnostic block when `CODEX_HOME` is present.

- [ ] Add failing `doctor.test.ts` coverage that expects new Codex checks only when `CODEX_HOME` is present.

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
```

Expected: FAIL because the helper and Codex-specific status/doctor output do not exist yet.

- [ ] Commit:

```bash
git add packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
git commit -m "test(core): define codex diagnostics contract"
```

### Task 2: Add A Shared Codex Diagnostics Snapshot Helper

**Files:**
- Create: `packages/core/src/tools/codex-diagnostics.ts`
- Create: `packages/core/tests/tools/codex-diagnostics.test.ts`
- Modify: `packages/core/src/types.ts`

- [ ] Implement `packages/core/src/tools/codex-diagnostics.ts` with a pure helper, for example `collectCodexDiagnostics(...)`, that:
  - returns `undefined` when `CODEX_HOME` is absent
  - resolves `sessionsDir` via `@locus/codex`
  - checks whether the sessions directory exists
  - discovers rollout files
  - records latest rollout path and readability using the existing lexicographically sorted rollout list
  - reads `LOCUS_CODEX_CAPTURE`
  - counts imported Codex events from `ingest_log`
  - reads the latest imported Codex event timestamp/session id from persisted rows

- [ ] Add or extend types in `packages/core/src/types.ts` for a structured Codex diagnostics snapshot used by both `memory_status` and `memory_doctor`.

- [ ] Keep the helper read-only and deterministic:
  - no writes
  - no inbox processing
  - no auto-import

- [ ] Re-run:

```bash
npm test -- packages/core/tests/tools/codex-diagnostics.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/src/tools/codex-diagnostics.ts packages/core/src/types.ts packages/core/tests/tools/codex-diagnostics.test.ts
git commit -m "feat(core): add codex diagnostics snapshot helper"
```

### Task 3: Expose Codex Diagnostics Through `memory_status`

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/tests/tools/status.test.ts`

- [ ] Extend `handleStatus(...)` so it accepts an optional Codex diagnostics snapshot and returns it in structured form only when present.

- [ ] Keep existing `codexAutoImport` behavior unchanged.

- [ ] Wire `createServer()` so `memory_status` computes a fresh Codex diagnostics snapshot at tool-call time and passes it into `handleStatus(...)`.

- [ ] Add or update tests that verify:
  - generic clients still get the current status shape without noisy Codex state
  - Codex-configured environments get the new structured block
  - imported event count, latest imported timestamp, and latest imported session are surfaced correctly
  - capture mode `off` is reflected as configuration state, not failure

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/status.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/src/tools/status.ts packages/core/src/server.ts packages/core/tests/tools/status.test.ts packages/core/src/types.ts
git commit -m "feat(core): expose codex diagnostics in memory_status"
```

### Task 4: Extend `memory_doctor` With Codex Checks

**Files:**
- Modify: `packages/core/src/tools/doctor.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/tests/tools/doctor.test.ts`

- [ ] Extend `DoctorDeps` so `handleDoctor(...)` can accept an optional Codex diagnostics snapshot.

- [ ] Append Codex-specific checks only when the snapshot is present. The checks should cover:
  - Codex sessions directory
  - latest rollout file readability
  - `LOCUS_CODEX_CAPTURE`
  - imported Codex event count
  - latest imported Codex session/event timestamp

- [ ] Keep statuses pragmatic:
  - missing sessions directory => `warn`
  - unreadable latest rollout => `fail`
  - `LOCUS_CODEX_CAPTURE=off` => `warn`
  - zero imported Codex events => `warn`
  - healthy imported state => `ok`

- [ ] Wire `memory_doctor` in `server.ts` so it computes the same shared Codex diagnostics snapshot used by `memory_status`.

- [ ] Add/adjust tests to prove:
  - healthy generic doctor output is unchanged when no Codex env exists
  - healthy Codex env produces additional checks
  - disabled capture is reported as an actionable warning
  - missing sessions dir / missing rollout files / unreadable latest rollout are diagnosed correctly
  - imported event count and latest imported session timestamp are reflected in the report

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/doctor.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/src/tools/doctor.ts packages/core/src/server.ts packages/core/tests/tools/doctor.test.ts packages/core/src/types.ts
git commit -m "feat(core): add codex checks to memory_doctor"
```

### Task 5: Prove MCP Wiring And Non-Codex Stability

**Files:**
- Modify: `packages/core/tests/integration/server.test.ts`

- [ ] Add integration coverage that starts the MCP server with a temporary `CODEX_HOME` and verifies:
  - `memory_status` returns Codex diagnostics
  - `memory_doctor` returns Codex checks

- [ ] Add regression coverage that verifies:
  - when `CODEX_HOME` is absent, `memory_doctor` does not emit Codex-specific checks
  - generic startup and search behavior remain unchanged

- [ ] Run:

```bash
npm test -- packages/core/tests/integration/server.test.ts
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/core/tests/integration/server.test.ts
git commit -m "test(core): cover codex doctor and status integration"
```

### Task 6: Document Diagnosis And Common Fixes

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `docs/roadmap/codex.md`

- [ ] Update `README.md` with a short Codex diagnosis section that explains how to use:
  - `memory_status` for structured state
  - `memory_doctor` for actionable checks
  - `memory_import_codex` only when manual catch-up is actually needed

- [ ] Add a concise common-fixes list:
  - verify `CODEX_HOME`
  - verify `sessions/` exists
  - verify rollout files exist
  - check `LOCUS_CODEX_CAPTURE`
  - use `memory_search` first, then `memory_status`, then `memory_doctor`, then manual import if needed

- [ ] Update `packages/codex/README.md` with the same support workflow, keeping VS Code/IDE limitations honest.

- [ ] Update `docs/roadmap/codex.md`:
  - mark Phase 5 as the active planned phase
  - note that the goal is diagnosis, not new capture behavior
  - move the immediate next step toward Phase 5 execution

- [ ] Run docs sanity search:

```bash
rg -n "memory_status|memory_doctor|LOCUS_CODEX_CAPTURE|CODEX_HOME|manual import" README.md packages/codex/README.md docs/roadmap/codex.md
```

- [ ] Commit:

```bash
git add README.md packages/codex/README.md docs/roadmap/codex.md
git commit -m "docs(codex): document codex diagnosis workflow"
```

### Task 7: Targeted Validation

**Files:** all modified repo files

- [ ] Run:

```bash
npm test -- packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/integration/server.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] Commit any formatting-only follow-up if needed:

```bash
git add <files>
git commit -m "chore(core): format codex diagnostics changes"
```

### Task 8: Full Validation And Phase 5 Checkpoint

**Files:** all modified repo files

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
git diff --stat codex-skill-upgrade-phase-4-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-skill-upgrade-phase-4-local..HEAD
```

- [ ] Update this plan file with completed checkboxes.

- [ ] Final checkpoint commit if needed:

```bash
git commit -m "chore(core): complete phase 5 validation"
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-doctor-status-phase-5-local -m "Codex doctor and status phase 5 local checkpoint"
```

## Manual Verification

After automated validation:

1. Start Codex CLI with Locus MCP configured and `CODEX_HOME` pointing at a real Codex home.
2. Run `memory_status` and verify the Codex diagnostic block reports sessions directory, rollout file count, capture mode, and imported event counts.
3. Run `memory_doctor` and verify the Codex checks clearly explain the current state.
4. Temporarily set `LOCUS_CODEX_CAPTURE=off` and verify doctor/status reflect disabled capture without treating it as a hard crash.
5. Remove or rename the `sessions/` directory in a temp setup and verify diagnostics clearly point at the missing path.

## Notes For Execution

- Keep the snapshot helper small and read-only; it is a Phase 5 diagnostic probe, not a new runtime subsystem.
- If rollout readability is hard to reproduce portably in tests, inject the helper output into `handleDoctor()`/`handleStatus()` rather than trying to force OS-level permission failures in unit tests.
- When implementing readability, prefer a lightweight file open/close probe over `fs.access()` or full file reads.
- If the latest imported timestamp is ambiguous, prefer the latest persisted Codex conversation event timestamp over `ingest_log.processed_at`, because users care about the imported conversation chronology more than ingest wall-clock time.
- When implementing import counters, prefer `ingest_log` over `conversation_events` for the aggregate count because the latter has no `source` index today.
- If support docs start drifting into installation docs, stop and keep Phase 5 focused on diagnosis. Installation UX belongs to later phases.
