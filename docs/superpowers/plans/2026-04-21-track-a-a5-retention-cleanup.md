# Track A A5 Retention Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make automatic memory retention understandable and safe by marking stale or superseded memories, surfacing cleanup suggestions, and allowing explicit user-controlled deletion without hidden destructive automation.

**Architecture:** keep cleanup advisory by default. Durable memories receive first-class states, a review engine computes cleanup suggestions, and the user can explicitly delete or bulk-delete through controlled tools. Existing `memory_compact` stays manual and is not used for silent automation.

**Tech Stack:** TypeScript, SQLite, Vitest, existing confirmation-token workflow, MCP tools.

---

## Dependencies

- Requires `A4` checkpoint: `track-a-a4-local`
- Depends on durable memory from `A3`
- Must not ship hidden deletion logic

## File Map

**Create:**
- `packages/core/src/memory/review.ts`
- `packages/core/src/tools/review.ts`
- `packages/core/tests/memory/review.test.ts`
- `packages/core/tests/tools/review.test.ts`
- `packages/core/tests/integration/memory-review-flow.test.ts`

**Modify:**
- `packages/core/src/types.ts`
- `packages/core/src/memory/durable.ts`
- `packages/core/src/tools/forget.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/server.ts`
- `packages/core/tests/tools/forget.test.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/tools/compact.test.ts`

## Retention Contract To Freeze

- Durable memory states are meaningful and visible:
  - `active`
  - `stale`
  - `superseded`
  - `archivable`
- `memory_review` is advisory only and returns cleanup candidates without deleting anything.
- `memory_forget` can delete by durable memory id or topic key with confirmation for bulk operations.
- The agent may suggest cleanup but must not perform it implicitly.

### Task 0: Branch From The A4 Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a5-retention-cleanup.md`

- [x] Verify the A4 checkpoint exists.

Run: `git tag --list track-a-a4-local`
Expected: prints `track-a-a4-local`.

- [x] Create the branch from the checkpoint.

Run: `git checkout track-a-a4-local`
Expected: detached HEAD at A4 checkpoint.

- [x] Create the feature branch.

Run: `git checkout -b feature/track-a-a5-retention-cleanup`
Expected: new branch created.

### Task 1: Freeze Review Tool And Durable State Contracts In Tests

**Files:**
- Create: `packages/core/tests/memory/review.test.ts`
- Create: `packages/core/tests/tools/review.test.ts`
- Modify: `packages/core/tests/tools/forget.test.ts`
- Modify: `packages/core/tests/tools/status.test.ts`

- [x] Add failing tests for:
  - superseded memories appear in review candidates
  - stale durable memories are suggested, not deleted
  - `memory_review` returns machine-friendly reasons and recommended actions
  - `memory_forget` can target durable ids or topic keys
  - status includes durable-memory state counts

- [x] Run the focused tests.

Run: `npm test -- packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts packages/core/tests/tools/forget.test.ts packages/core/tests/tools/status.test.ts`
Expected: FAIL because review tooling does not exist yet.

- [x] Commit the failing tests.

Run: `git add packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts packages/core/tests/tools/forget.test.ts packages/core/tests/tools/status.test.ts`
Expected: test-only change set staged.

- [x] Commit.

Run: `git commit -m "test(core): define memory review and cleanup contracts"`
Expected: test-only commit created.

### Task 2: Implement Durable Review Engine

**Files:**
- Create: `packages/core/src/memory/review.ts`
- Modify: `packages/core/src/memory/durable.ts`
- Modify: `packages/core/src/types.ts`

- [x] Implement a pure review engine that produces candidates for:
  - superseded durable memories
  - duplicate confirmations
  - aged but still readable archivable memories
  - stale low-value durable entries

- [x] Expose counts by durable state from the durable store.

- [x] Re-run the review unit tests.

Run: `npm test -- packages/core/tests/memory/review.test.ts`
Expected: PASS.

- [x] Commit the review engine.

Run: `git add packages/core/src/memory/review.ts packages/core/src/memory/durable.ts packages/core/src/types.ts`
Expected: review engine files staged.

- [x] Commit.

Run: `git commit -m "feat(core): add durable memory review engine"`
Expected: implementation commit created.

### Task 3: Expose `memory_review` As A Non-Destructive MCP Tool

**Files:**
- Create: `packages/core/src/tools/review.ts`
- Modify: `packages/core/src/server.ts`
- Create: `packages/core/tests/tools/review.test.ts`
- Create: `packages/core/tests/integration/memory-review-flow.test.ts`

- [x] Add the `memory_review` tool with optional filters such as `state`, `topicKey`, and `limit`.

- [x] Ensure the tool returns only review output and never deletes state.

- [x] Run the review tool tests.

Run: `npm test -- packages/core/tests/tools/review.test.ts packages/core/tests/integration/memory-review-flow.test.ts`
Expected: PASS.

- [x] Commit the tool wiring.

Run: `git add packages/core/src/tools/review.ts packages/core/src/server.ts packages/core/tests/tools/review.test.ts packages/core/tests/integration/memory-review-flow.test.ts`
Expected: review tool changes staged.

- [x] Commit.

Run: `git commit -m "feat(core): expose memory review tool"`
Expected: implementation commit created.

### Task 4: Extend `memory_forget` For Durable Memory Targets

**Files:**
- Modify: `packages/core/src/tools/forget.ts`
- Modify: `packages/core/tests/tools/forget.test.ts`
- Modify: `packages/core/src/types.ts`

- [x] Extend forget query parsing to support durable targets such as:
  - `durable:17`
  - `topic:database_choice`
  - plain semantic text fallback

- [x] Keep bulk-deletion confirmation rules intact.

- [x] Re-run forget tests.

Run: `npm test -- packages/core/tests/tools/forget.test.ts`
Expected: PASS.

- [x] Commit the durable forget path.

Run: `git add packages/core/src/tools/forget.ts packages/core/tests/tools/forget.test.ts packages/core/src/types.ts`
Expected: forget-path changes staged.

- [x] Commit.

Run: `git commit -m "feat(core): support durable memory deletion targets"`
Expected: implementation commit created.

### Task 5: Surface Retention State In Status And Preserve Compact Safety

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/tests/tools/status.test.ts`
- Modify: `packages/core/tests/tools/compact.test.ts`

- [x] Add durable-state counts or a compact durable-memory summary to `memory_status`.

- [x] Ensure `memory_compact` tests still reflect that compact is manual and does not become hidden auto-cleanup.

- [x] Run the status and compact tests.

Run: `npm test -- packages/core/tests/tools/status.test.ts packages/core/tests/tools/compact.test.ts`
Expected: PASS.

- [x] Commit the status visibility changes.

Run: `git add packages/core/src/tools/status.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/compact.test.ts`
Expected: status and compact changes staged.

- [x] Commit.

Run: `git commit -m "feat(core): expose durable retention state in status"`
Expected: implementation commit created.

### Task 6: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a5-retention-cleanup.md`

- [ ] Run the A5 validation suite.

Run: `npm test -- packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts packages/core/tests/tools/forget.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/compact.test.ts packages/core/tests/integration/memory-review-flow.test.ts`
Expected: PASS.

- [ ] Run workspace typecheck.

Run: `npm run typecheck`
Expected: PASS.

- [ ] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a5-retention-cleanup.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a5 validation"`
Expected: final A5 validation commit created.

- [ ] Tag the checkpoint.

Run: `git tag -a track-a-a5-local -m "Track A A5 retention cleanup local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- Users can inspect cleanup candidates before deletion.
- Durable memory states are visible and meaningful.
- Cleanup remains user-controlled and confirmation-gated for bulk operations.
- Existing manual `memory_compact` behavior does not turn into silent automation.
