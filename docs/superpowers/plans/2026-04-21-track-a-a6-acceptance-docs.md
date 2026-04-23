# Track A A6 Acceptance Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** prove that Track A actually closes the Codex memory trust gap and make every shipped doc and diagnostic statement match the validated runtime behavior.

**Architecture:** codify real acceptance fixtures and integration tests first, then align `memory_status`, `memory_doctor`, README, Codex docs, and roadmap wording with what the tests prove. This plan is the truth pass: it should remove any marketing drift between product story and validated recall behavior.

**Tech Stack:** Vitest integration tests, sanitized JSONL fixtures, MCP tools, Markdown docs, git tags.

---

## Dependencies

- Requires `A5` checkpoint: `track-a-a5-local`
- Must run after the runtime, capture, extraction, recall, and retention layers are all available
- This is the last plan in the Track A chain

## File Map

**Create:**
- `packages/codex/tests/fixtures/track-a/recall-bugfix.jsonl`
- `packages/codex/tests/fixtures/track-a/recall-decisions.jsonl`
- `packages/core/tests/integration/track-a-recall-acceptance.test.ts`
- `packages/core/tests/integration/track-a-desktop-diagnostics.test.ts`
- `docs/codex-acceptance-matrix.md`

**Modify:**
- `packages/core/src/tools/doctor.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/tests/tools/doctor.test.ts`
- `packages/core/tests/tools/status.test.ts`
- `README.md`
- `packages/codex/README.md`
- `docs/codex-vscode-extension.md`
- `docs/roadmap/codex-next.md`
- `docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`

## Acceptance Contract To Freeze

Track A is not complete unless the following are proven:

- Codex CLI can recover useful recent context from a real fixture-backed session.
- Durable decisions appear in recall results.
- `metadata` is described as limited recall, not strong conversational memory.
- Diagnostics explain when desktop or extension parity is incomplete.
- README and Codex docs describe the actual recommended capture mode and recall flow.

### Task 0: Branch From The A5 Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a6-acceptance-docs.md`

- [x] Verify the A5 checkpoint exists.

Run: `git tag --list track-a-a5-local`
Expected: prints `track-a-a5-local`.

- [x] Create the branch from the checkpoint.

Run: `git checkout track-a-a5-local`
Expected: detached HEAD at A5 checkpoint.

- [x] Create the feature branch.

Run: `git checkout -b feature/track-a-a6-acceptance-docs`
Expected: new branch created.

### Task 1: Add Sanitized Track A Acceptance Fixtures

**Files:**
- Create: `packages/codex/tests/fixtures/track-a/recall-bugfix.jsonl`
- Create: `packages/codex/tests/fixtures/track-a/recall-decisions.jsonl`

- [x] Add one fixture emphasizing recent bug-fixing recall and one emphasizing decision memory.

- [x] Verify the fixtures contain no real secrets.

Run: `rg -n "OPENAI|sk-|token|password|secret|Bearer" packages/codex/tests/fixtures/track-a`
Expected: no real secrets in the new fixtures.

- [x] Commit the acceptance fixtures.

Run: `git add packages/codex/tests/fixtures/track-a/recall-bugfix.jsonl packages/codex/tests/fixtures/track-a/recall-decisions.jsonl`
Expected: fixture files staged.

- [x] Commit.

Run: `git commit -m "test(codex): add track a acceptance fixtures"`
Expected: fixture commit created.

### Task 2: Freeze Track A Acceptance Tests Before Doc Edits

**Files:**
- Create: `packages/core/tests/integration/track-a-recall-acceptance.test.ts`
- Create: `packages/core/tests/integration/track-a-desktop-diagnostics.test.ts`
- Modify: `packages/core/tests/tools/doctor.test.ts`
- Modify: `packages/core/tests/tools/status.test.ts`

- [x] Add failing tests for:
  - CLI recall over the new fixtures returns useful summary-first results
  - durable decisions are present in recall output
  - `memory_status` warns when capture mode is too weak for strong recall
  - `memory_doctor` flags limited recall when capture mode is `metadata`
  - desktop/extension diagnostics are honest when parity is incomplete

- [x] Run the acceptance-focused tests.

Run: `npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts`
Expected: FAIL until the truth messaging is implemented.

- [x] Commit the failing acceptance tests.

Run: `git add packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts`
Expected: acceptance tests staged.

- [x] Commit.

Run: `git commit -m "test(core): define track a acceptance and truth checks"`
Expected: test-only commit created.

### Task 3: Align Status And Doctor Messaging With Real Recall Truth

**Files:**
- Modify: `packages/core/src/tools/doctor.ts`
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/tests/tools/doctor.test.ts`
- Modify: `packages/core/tests/tools/status.test.ts`

- [x] Add explicit messaging when:
  - capture mode is `metadata`
  - conversational recall is intentionally limited
  - desktop/extension parity is unverified or partial

- [x] Avoid green-check messaging that implies strong recall when only ingest plumbing is healthy.

- [x] Re-run the truth-messaging tests.

Run: `npm test -- packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts`
Expected: PASS.

- [x] Commit the status/doctor truth pass.

Run: `git add packages/core/src/tools/doctor.ts packages/core/src/tools/status.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts`
Expected: truth-messaging changes staged.

- [x] Commit.

Run: `git commit -m "feat(core): make recall limitations explicit in status and doctor"`
Expected: implementation commit created.

### Task 4: Make Acceptance Tests Green

**Files:**
- Modify: `packages/core/tests/integration/track-a-recall-acceptance.test.ts`
- Modify: `packages/core/tests/integration/track-a-desktop-diagnostics.test.ts`

- [x] Fix any remaining fixture wiring or helper gaps until the new acceptance tests pass without weakening the contract.

- [x] Run the acceptance suite.

Run: `npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts`
Expected: PASS.

- [x] Commit the final acceptance green state.

Run: `git add packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts`
Expected: final acceptance changes staged.

- [x] Commit.

Run: `git commit -m "test(core): validate track a codex recall acceptance"`
Expected: test commit created.

### Task 5: Update Public Docs And Acceptance Matrix

**Files:**
- Create: `docs/codex-acceptance-matrix.md`
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `docs/codex-vscode-extension.md`
- Modify: `docs/roadmap/codex-next.md`
- Modify: `docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`

- [ ] Add a compact acceptance matrix documenting:
  - CLI
  - desktop/extension
  - manual MCP fallback
  - capture mode expectations

- [ ] Update README and Codex docs so they describe:
  - the validated recall flow
  - the recommended capture mode
  - the meaning of `metadata`, `redacted`, and `full`
  - the fact that desktop parity may differ from CLI

- [ ] Update roadmap/spec status text only if it helps separate delivered Track A behavior from future work.

- [ ] Verify docs alignment with quick grep checks.

Run: `rg -n "metadata|redacted|full|recall|memory_recall|desktop|CLI|parity" README.md packages/codex/README.md docs/codex-vscode-extension.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`
Expected: all updated docs mention the same product story without contradictions.

- [ ] Commit the docs truth pass.

Run: `git add docs/codex-acceptance-matrix.md README.md packages/codex/README.md docs/codex-vscode-extension.md docs/roadmap/codex-next.md docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`
Expected: docs-only change set staged.

- [ ] Commit.

Run: `git commit -m "docs(codex): align track a docs with validated recall"`
Expected: docs commit created.

### Task 6: Final Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a6-acceptance-docs.md`

- [ ] Run the full Track A validation subset.

Run: `npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/memory/durable.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/review.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/importer.test.ts`
Expected: PASS.

- [ ] Run workspace typecheck.

Run: `npm run typecheck`
Expected: PASS.

- [ ] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a6-acceptance-docs.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a6 validation"`
Expected: final A6 validation commit created.

- [ ] Tag the checkpoint.

Run: `git tag -a track-a-a6-local -m "Track A A6 acceptance and docs local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- Track A has fixture-backed proof that Codex recall is meaningfully useful.
- Status and doctor messaging distinguish ingest health from recall usefulness.
- Public docs and the master spec describe the shipped behavior honestly.
- The repo has a clear acceptance matrix for CLI, desktop/extension, and manual fallback.
