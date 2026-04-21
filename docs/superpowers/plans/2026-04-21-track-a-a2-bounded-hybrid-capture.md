# Track A A2 Bounded Hybrid Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the current weak all-or-nothing Codex content capture with bounded, rule-based, project-relevant capture that preserves useful recent working context without turning Locus into a transcript dump.

**Architecture:** keep the existing `metadata` / `redacted` / `full` user-facing modes, but redefine the `redacted` path into a bounded hybrid capture policy. Implement the policy inside `packages/codex` through small focused helpers: relevance classification, snippet extraction, redaction, and inbox payload shaping. Do not require model calls on the write path.

**Tech Stack:** TypeScript in `packages/codex`, JSONL fixtures, Vitest, existing inbox event protocol, existing ingest pipeline compatibility tests.

---

## Dependencies

- Requires `A1` checkpoint: `track-a-a1-local`
- Must not require `A3-A6`
- Must preserve compatibility with the existing inbox schema and core ingest pipeline

## File Map

**Create:**
- `packages/codex/src/relevance.ts`
- `packages/codex/src/bounded-snippets.ts`
- `packages/codex/tests/relevance.test.ts`
- `packages/codex/tests/bounded-snippets.test.ts`
- `packages/codex/tests/fixtures/noisy-session.jsonl`
- `packages/codex/tests/fixtures/decision-session.jsonl`

**Modify:**
- `packages/codex/src/capture.ts`
- `packages/codex/src/normalize.ts`
- `packages/codex/src/inbox-event.ts`
- `packages/codex/src/importer.ts`
- `packages/codex/src/types.ts`
- `packages/codex/src/index.ts`
- `packages/codex/tests/capture.test.ts`
- `packages/codex/tests/normalize.test.ts`
- `packages/codex/tests/inbox-event.test.ts`
- `packages/codex/tests/importer.test.ts`
- `packages/codex/tests/core-compat.test.ts`

## Capture Contract To Freeze

- `metadata` stays minimal and should not be marketed as useful conversational recall.
- `redacted` becomes the recommended bounded-hybrid mode:
  - keep high-signal user problem statements
  - keep short assistant decision/problem-solving snippets
  - keep session summaries and tool metadata
  - drop obvious noise and generic learning chatter
  - redact secrets before storage
- `full` keeps maximum recall and bypasses bounded snippet reduction, but still passes through secret redaction best effort.
- Every kept conversational payload in `redacted` should carry enough metadata to explain why it was kept, for example:

```ts
{
  prompt: "...redacted excerpt...",
  capture_policy: "bounded_redacted",
  capture_reason: "decision" | "preference" | "bug_context" | "next_step",
  truncated: true | false
}
```

### Task 0: Branch From The A1 Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a2-bounded-hybrid-capture.md`

- [x] Verify the A1 checkpoint exists locally.

Run: `git tag --list track-a-a1-local`
Expected: prints `track-a-a1-local`.

- [x] Create the working branch from the checkpoint.

Run: `git checkout track-a-a1-local`
Expected: detached HEAD at A1 checkpoint.

- [x] Create the feature branch.

Run: `git checkout -b feature/track-a-a2-bounded-capture`
Expected: new branch created.

### Task 1: Freeze Bounded Capture Semantics In Tests

**Files:**
- Create: `packages/codex/tests/relevance.test.ts`
- Create: `packages/codex/tests/bounded-snippets.test.ts`
- Modify: `packages/codex/tests/capture.test.ts`
- Modify: `packages/codex/tests/normalize.test.ts`

- [x] Add failing tests for:
  - noisy generic questions are rejected in `redacted`
  - bug-fixing context is kept in `redacted`
  - assistant rambling is clipped to a bounded snippet
  - `metadata` continues to skip user and assistant content
  - `full` still keeps full text

- [x] Run the capture-focused tests.

Run: `npm test -- packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/normalize.test.ts`
Expected: FAIL because the new helpers and contract do not exist yet.

- [x] Commit the failing tests.

Run: `git add packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/normalize.test.ts`
Expected: test-only change set staged.

- [x] Commit.

Run: `git commit -m "test(codex): define bounded capture contract"`
Expected: test-only commit created.

### Task 2: Add Sanitized Track A Fixtures

**Files:**
- Create: `packages/codex/tests/fixtures/noisy-session.jsonl`
- Create: `packages/codex/tests/fixtures/decision-session.jsonl`
- Modify: `packages/codex/tests/importer.test.ts`

- [x] Add one noisy fixture and one high-signal decision fixture with no real secrets.

- [x] Verify the fixture set is sanitized.

Run: `rg -n "OPENAI|sk-|token|password|secret|Bearer" packages/codex/tests/fixtures`
Expected: no real secrets in the new fixtures.

- [x] Commit the fixtures.

Run: `git add packages/codex/tests/fixtures/noisy-session.jsonl packages/codex/tests/fixtures/decision-session.jsonl packages/codex/tests/importer.test.ts`
Expected: new fixtures staged.

- [x] Commit.

Run: `git commit -m "test(codex): add bounded capture fixtures"`
Expected: fixture commit created.

### Task 3: Implement Relevance Classification And Snippet Bounding

**Files:**
- Create: `packages/codex/src/relevance.ts`
- Create: `packages/codex/src/bounded-snippets.ts`
- Modify: `packages/codex/src/index.ts`

- [x] Implement a deterministic relevance classifier that labels text as:
  - `noise`
  - `bug_context`
  - `decision`
  - `preference`
  - `next_step`
  - `general_context`

- [x] Implement bounded snippet helpers for user and assistant text with clear limits and truncation markers.

- [x] Export the helpers for unit tests only through package source exports.

- [x] Re-run the new helper tests.

Run: `npm test -- packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts`
Expected: PASS.

- [x] Commit the helper layer.

Run: `git add packages/codex/src/relevance.ts packages/codex/src/bounded-snippets.ts packages/codex/src/index.ts`
Expected: helper implementation staged.

- [x] Commit.

Run: `git commit -m "feat(codex): add bounded relevance and snippet helpers"`
Expected: implementation commit created.

### Task 4: Redefine Redacted Capture Around The Bounded Policy

**Files:**
- Modify: `packages/codex/src/capture.ts`
- Modify: `packages/codex/src/types.ts`
- Modify: `packages/codex/src/normalize.ts`

- [x] Extend capture types so normalization and inbox shaping can see:
  - capture reason
  - truncated flag
  - whether text was retained or filtered

- [x] Update `capture.ts` so `redacted` no longer means "everything except AI response"; it should mean "keep only bounded, relevant, redacted conversational context".

- [x] Keep the secret redaction comment explicit that this is best effort, not complete DLP.

- [x] Re-run the capture tests.

Run: `npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/normalize.test.ts`
Expected: PASS.

- [x] Commit the policy rewrite.

Run: `git add packages/codex/src/capture.ts packages/codex/src/types.ts packages/codex/src/normalize.ts`
Expected: capture-policy files staged.

- [x] Commit.

Run: `git commit -m "feat(codex): redefine redacted as bounded hybrid capture"`
Expected: implementation commit created.

### Task 5: Shape Inbox Events For Inspectable Working Context

**Files:**
- Modify: `packages/codex/src/inbox-event.ts`
- Modify: `packages/codex/tests/inbox-event.test.ts`
- Modify: `packages/codex/tests/core-compat.test.ts`

- [x] Update inbox event generation so kept bounded snippets include inspection metadata such as `capture_policy`, `capture_reason`, and `truncated`.

- [x] Keep the event kinds unchanged so core ingest does not need a schema break in `A2`.

- [x] Add tests proving the new payload shape still passes core compat validation.

- [x] Run the payload compatibility tests.

Run: `npm test -- packages/codex/tests/inbox-event.test.ts packages/codex/tests/core-compat.test.ts`
Expected: PASS.

- [x] Commit the inbox payload shaping.

Run: `git add packages/codex/src/inbox-event.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/core-compat.test.ts`
Expected: payload shaping changes staged.

- [x] Commit.

Run: `git commit -m "feat(codex): add inspectable bounded payload metadata"`
Expected: implementation commit created.

### Task 6: Wire The Importer And Prove End-To-End Capture Behavior

**Files:**
- Modify: `packages/codex/src/importer.ts`
- Modify: `packages/codex/tests/importer.test.ts`

- [ ] Ensure the importer passes the new bounded capture logic end-to-end for:
  - `metadata`
  - `redacted`
  - `full`

- [ ] Add tests against the new fixtures proving:
  - noisy sessions do not flood the inbox in `redacted`
  - decision sessions keep bounded useful context
  - `latestSession` and existing metrics still behave correctly

- [ ] Run the importer tests.

Run: `npm test -- packages/codex/tests/importer.test.ts`
Expected: PASS.

- [ ] Commit the importer wiring.

Run: `git add packages/codex/src/importer.ts packages/codex/tests/importer.test.ts`
Expected: importer changes staged.

- [ ] Commit.

Run: `git commit -m "feat(codex): apply bounded capture in importer"`
Expected: implementation commit created.

### Task 7: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a2-bounded-hybrid-capture.md`

- [ ] Run the A2 validation suite.

Run: `npm test -- packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/normalize.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts`
Expected: PASS.

- [ ] Run workspace typecheck.

Run: `npm run typecheck`
Expected: PASS.

- [ ] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a2-bounded-hybrid-capture.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a2 validation"`
Expected: final A2 validation commit created.

- [ ] Tag the checkpoint.

Run: `git tag -a track-a-a2-local -m "Track A A2 bounded hybrid capture local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- `metadata` remains minimal and honest.
- `redacted` becomes a bounded, inspectable, project-relevant capture path.
- No model calls are required on the write path.
- Existing inbox/core compat tests still pass with the richer bounded payload metadata.
