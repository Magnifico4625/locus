# Track A A1 Runtime Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make Codex runtime detection and path identity trustworthy enough that auto-import and diagnostics reflect real Codex CLI and Codex desktop launches instead of silently degrading to generic mode.

**Architecture:** add a shared normalization layer in `packages/shared-runtime`, expand runtime detection from a single boolean env check into a structured runtime snapshot, and thread that snapshot through auto-import, status, and diagnostics. Preserve backward compatibility for existing shared-runtime consumers by keeping `detectClientEnv()` as a compatibility wrapper while introducing richer runtime detection for Track A.

**Tech Stack:** plain ESM JS shared-runtime, TypeScript in `packages/core` and `packages/codex`, Vitest, MCP status/diagnostic tools, git tags.

---

## Dependencies

- Requires the merged master spec `docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`
- Baseline tag created from current stable planning state: `track-a-baseline-2026-04-21`
- Does not require `A2-A6`

## File Map

**Create:**
- `packages/shared-runtime/normalize-path.js`
- `packages/shared-runtime/normalize-path.d.ts`
- `packages/core/tests/shared-runtime/normalize-path.test.ts`
- `packages/core/tests/integration/codex-runtime-truth.test.ts`

**Modify:**
- `packages/shared-runtime/detect-client.js`
- `packages/shared-runtime/detect-client.d.ts`
- `packages/shared-runtime/project-hash.js`
- `packages/shared-runtime/index.js`
- `packages/shared-runtime/index.d.ts`
- `packages/codex/src/paths.ts`
- `packages/core/src/types.ts`
- `packages/core/src/tools/auto-import-codex.ts`
- `packages/core/src/tools/codex-diagnostics.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/server.ts`
- `packages/core/tests/shared-runtime/detect-client.test.ts`
- `packages/core/tests/shared-runtime/project-hash.test.ts`
- `packages/core/tests/shared-runtime/regression-paths.test.ts`
- `packages/core/tests/tools/auto-import-codex.test.ts`
- `packages/core/tests/tools/codex-diagnostics.test.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/integration/codex-auto-import-search.test.ts`

## Runtime Contract To Freeze

- `normalizePathForIdentity(path)` returns a stable slash-normalized path representation for hashing, dedup, diagnostics, and runtime identity comparisons.
- `detectClientRuntime(env?, argv?, cwd?)` returns an object shaped like:

```ts
{
  client: 'codex' | 'claude-code' | 'generic';
  surface: 'cli' | 'desktop' | 'extension' | 'generic';
  detected: boolean;
  evidence: string[];
}
```

- Existing `detectClientEnv()` remains available and returns only `client`.
- `memory_status` and `memory_doctor` expose enough Codex runtime detail to explain why auto-import did or did not run.
- Auto-import gating continues to trigger only for Codex, but now uses the richer runtime snapshot instead of a bare `CODEX_HOME` presence check.

### Task 0: Create A1 Branch And Baseline Tag

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a1-runtime-truth.md`

- [x] Verify the spec branch is clean enough to branch from.

Run: `git status --short`
Expected: only expected planning docs are modified or the working tree is clean.

- [x] Create the baseline tag if it does not already exist.

Run: `git tag --list track-a-baseline-2026-04-21`
Expected: empty output before creation or the exact tag if already created.

- [x] Create the working branch for A1.

Run: `git checkout -b feature/track-a-a1-runtime-truth`
Expected: branch switches successfully.

- [x] Commit the plan bundle baseline before touching runtime code.

Run: `git add docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md docs/superpowers/plans/2026-04-21-track-a-plan-bundle.md docs/superpowers/plans/2026-04-21-track-a-a1-runtime-truth.md`
Expected: staged docs only.

- [x] Commit.

Run: `git commit -m "docs(codex): add track a runtime truth plan"`
Expected: docs-only commit created.

Note: satisfied by prior docs-only planning checkpoint commit `7aee241` (`docs(codex): add track a implementation plan bundle`), then branched into `feature/track-a-a1-runtime-truth` for execution.

### Task 1: Freeze Shared Runtime Normalization Contract In Tests

**Files:**
- Create: `packages/core/tests/shared-runtime/normalize-path.test.ts`
- Modify: `packages/core/tests/shared-runtime/project-hash.test.ts`
- Modify: `packages/core/tests/shared-runtime/regression-paths.test.ts`

- [x] Add failing tests for normalization rules:
  - Windows backslashes become `/`
  - drive letters compare consistently
  - duplicate separators are normalized
  - the same logical project path hashes identically after normalization

- [x] Run the focused shared-runtime tests.

Run: `npm test -- packages/core/tests/shared-runtime/normalize-path.test.ts packages/core/tests/shared-runtime/project-hash.test.ts packages/core/tests/shared-runtime/regression-paths.test.ts`
Expected: FAIL because the new helper does not exist yet.

- [x] Commit the failing contract tests.

Run: `git add packages/core/tests/shared-runtime/normalize-path.test.ts packages/core/tests/shared-runtime/project-hash.test.ts packages/core/tests/shared-runtime/regression-paths.test.ts`
Expected: only shared-runtime tests staged.

- [x] Commit.

Run: `git commit -m "test(core): define runtime path normalization contract"`
Expected: test-only commit created.

### Task 2: Implement Shared Normalization Utilities

**Files:**
- Create: `packages/shared-runtime/normalize-path.js`
- Create: `packages/shared-runtime/normalize-path.d.ts`
- Modify: `packages/shared-runtime/project-hash.js`
- Modify: `packages/shared-runtime/index.js`
- Modify: `packages/shared-runtime/index.d.ts`

- [x] Implement `normalizePathForIdentity(pathValue)` in shared-runtime and export it from the barrel.

- [x] Refactor `projectHash()` to call the shared helper instead of embedding its own normalization logic.

- [x] Keep the helper dependency-free and safe for hooks and plain JS consumers.

- [x] Re-run the shared-runtime tests.

Run: `npm test -- packages/core/tests/shared-runtime/normalize-path.test.ts packages/core/tests/shared-runtime/project-hash.test.ts packages/core/tests/shared-runtime/regression-paths.test.ts`
Expected: PASS.

- [x] Commit the shared-runtime implementation.

Run: `git add packages/shared-runtime/normalize-path.js packages/shared-runtime/normalize-path.d.ts packages/shared-runtime/project-hash.js packages/shared-runtime/index.js packages/shared-runtime/index.d.ts`
Expected: only shared-runtime files staged.

- [x] Commit.

Run: `git commit -m "feat(shared-runtime): add identity path normalization"`
Expected: implementation commit created.

### Task 3: Freeze Structured Runtime Detection Contract

**Files:**
- Modify: `packages/core/tests/shared-runtime/detect-client.test.ts`
- Modify: `packages/core/tests/tools/auto-import-codex.test.ts`
- Modify: `packages/core/tests/tools/codex-diagnostics.test.ts`
- Modify: `packages/core/tests/tools/status.test.ts`

- [x] Extend tests to define the new runtime snapshot contract:
  - plain `CODEX_HOME` maps to `client='codex'`
  - desktop/extension-like launches can still report `client='codex'` with a non-generic surface
  - `detectClientEnv()` remains backward compatible
  - auto-import marks `skipped_not_codex` only when runtime detection is truly non-Codex
  - status and diagnostics surface detection evidence

- [x] Run the targeted tests.

Run: `npm test -- packages/core/tests/shared-runtime/detect-client.test.ts packages/core/tests/tools/auto-import-codex.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts`
Expected: FAIL because the richer runtime API does not exist yet.

- [x] Commit the failing detection tests.

Run: `git add packages/core/tests/shared-runtime/detect-client.test.ts packages/core/tests/tools/auto-import-codex.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts`
Expected: test-only change set staged.

- [x] Commit.

Run: `git commit -m "test(core): define codex runtime detection contract"`
Expected: test-only commit created.

### Task 4: Implement Structured Runtime Detection In Shared Runtime

**Files:**
- Modify: `packages/shared-runtime/detect-client.js`
- Modify: `packages/shared-runtime/detect-client.d.ts`
- Modify: `packages/shared-runtime/index.js`
- Modify: `packages/shared-runtime/index.d.ts`

- [x] Add `detectClientRuntime(env?, argv?, cwd?)` returning the structured runtime object.

- [x] Keep `detectClientEnv()` as a thin wrapper returning only `runtime.client`.

- [x] Encode explicit evidence strings in the runtime result so diagnostics can explain what matched.

- [x] Re-run shared runtime detection tests.

Run: `npm test -- packages/core/tests/shared-runtime/detect-client.test.ts`
Expected: PASS.

- [x] Commit the detection implementation.

Run: `git add packages/shared-runtime/detect-client.js packages/shared-runtime/detect-client.d.ts packages/shared-runtime/index.js packages/shared-runtime/index.d.ts`
Expected: shared-runtime detection files staged.

- [x] Commit.

Run: `git commit -m "feat(shared-runtime): add structured client runtime detection"`
Expected: implementation commit created.

### Task 5: Thread Runtime Truth Through Core Auto-Import And Diagnostics

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/tools/auto-import-codex.ts`
- Modify: `packages/core/src/tools/codex-diagnostics.ts`
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/codex/src/paths.ts`

- [x] Extend the Codex snapshot types with runtime surface and evidence fields.

- [x] Update the auto-import coordinator to consume `detectClientRuntime()` and persist a runtime snapshot instead of only `clientDetected: boolean`.

- [x] Normalize all path-like values included in status and diagnostics snapshots.

- [x] Keep `resolveCodexHome()` and `resolveCodexSessionsDir()` aligned with the same normalization rules where identity matters.

Note: raw filesystem path resolution in `packages/codex/src/paths.ts` was intentionally left unchanged for actual file access; normalization was applied at the status/diagnostics snapshot layer so runtime identity is stable without risking path-read regressions.

- [x] Re-run the targeted tests.

Run: `npm test -- packages/core/tests/tools/auto-import-codex.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts`
Expected: PASS.

- [x] Commit the core wiring.

Run: `git add packages/core/src/types.ts packages/core/src/tools/auto-import-codex.ts packages/core/src/tools/codex-diagnostics.ts packages/core/src/tools/status.ts packages/core/src/server.ts packages/codex/src/paths.ts`
Expected: runtime-truth implementation staged.

- [x] Commit.

Run: `git commit -m "feat(core): expose codex runtime truth snapshots"`
Expected: implementation commit created.

### Task 6: Add Integration Coverage For Real Runtime Paths

**Files:**
- Create: `packages/core/tests/integration/codex-runtime-truth.test.ts`
- Modify: `packages/core/tests/integration/codex-auto-import-search.test.ts`

- [x] Add an integration test that starts the server under Codex-like env and proves:
  - the runtime snapshot says Codex
  - auto-import is allowed to run
  - status includes normalized paths and structured detection evidence

- [x] Add a generic runtime test that proves the same server does not pretend to be Codex.

- [x] Run the integration tests.

Run: `npm test -- packages/core/tests/integration/codex-runtime-truth.test.ts packages/core/tests/integration/codex-auto-import-search.test.ts`
Expected: PASS.

- [x] Commit the integration coverage.

Run: `git add packages/core/tests/integration/codex-runtime-truth.test.ts packages/core/tests/integration/codex-auto-import-search.test.ts`
Expected: integration tests staged.

- [x] Commit.

Run: `git commit -m "test(core): cover codex runtime truth integration"`
Expected: test commit created.

### Task 7: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a1-runtime-truth.md`

- [x] Run the focused validation suite.

Run: `npm test -- packages/core/tests/shared-runtime/detect-client.test.ts packages/core/tests/shared-runtime/normalize-path.test.ts packages/core/tests/shared-runtime/project-hash.test.ts packages/core/tests/shared-runtime/regression-paths.test.ts packages/core/tests/tools/auto-import-codex.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/integration/codex-runtime-truth.test.ts packages/core/tests/integration/codex-auto-import-search.test.ts`
Expected: PASS.

- [x] Run a workspace typecheck for the affected packages.

Run: `npm run typecheck`
Expected: PASS.

- [x] Update this plan with completion state if desired by the execution workflow.

- [x] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a1-runtime-truth.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a1 validation"`
Expected: final A1 validation commit created.

- [x] Tag the checkpoint.

Run: `git tag -a track-a-a1-local -m "Track A A1 runtime truth local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- Auto-import no longer depends on a single fragile env flag.
- Path identity is normalized consistently across hashing, diagnostics, and runtime snapshots.
- `memory_status` and `memory_doctor` can explain why a Codex session was or was not detected.
- CLI remains the hard gate, while desktop/extension launches can be represented honestly instead of collapsing into `generic`.
