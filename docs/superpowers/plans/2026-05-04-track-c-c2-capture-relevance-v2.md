# Track C C2 Capture/Relevance v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex `redacted` capture keep high-value dialogue snippets while filtering noise and improving best-effort secret redaction.

**Architecture:** Expand capture reasons and relevance classification inside `@locus/codex`, then feed richer annotations through the existing inbox protocol. Use per-capture-reason snippet limits with a global hard maximum; do not change core storage schema.

**Tech Stack:** TypeScript, Vitest, existing `@locus/codex` capture/importer modules, existing inbox event compatibility tests.

---

## Scope

In scope:

- expanded `CodexCaptureReason`
- stronger RU/EN relevance rules
- per-reason snippet limits under hard max
- stronger best-effort redaction
- assistant high-value retention
- tests proving `redacted` keeps useful context and drops noise

Out of scope:

- recall ranking
- durable extraction
- schema migrations
- hooks

## File Structure

Modify:

- `packages/codex/src/types.ts`
- `packages/codex/src/relevance.ts`
- `packages/codex/src/bounded-snippets.ts`
- `packages/codex/src/capture.ts`
- `packages/codex/src/inbox-event.ts`
- `packages/codex/tests/capture.test.ts`
- `packages/codex/tests/bounded-snippets.test.ts`
- `packages/codex/tests/inbox-event.test.ts`
- `packages/codex/tests/importer.test.ts`
- `packages/codex/tests/core-compat.test.ts`
- `packages/codex/tests/relevance.test.ts`
- `packages/codex/tests/redaction.test.ts`

Test ownership notes:

- `packages/codex/tests/relevance.test.ts` already exists; extend it in place.
- Redaction coverage currently exists in `capture.test.ts`. Create focused
  `redaction.test.ts` for v2 and move/split the relevant cases deliberately;
  keep at most one smoke assertion in `capture.test.ts` to avoid duplicate
  maintenance.

Do not modify:

- `packages/core/src/storage/**`
- `packages/claude-code/**`

---

## Task C2.0: Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c2-capture-relevance-v2.md`

- [x] **Step 1: Verify C1 checkpoint**

Run:

```bash
git status --short --branch
git tag --list "track-c-c1-local"
```

Expected: clean tree and `track-c-c1-local` exists unless C1 was intentionally skipped.

- [x] **Step 2: Run existing Codex capture tests**

Run:

```bash
npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts
```

Expected: PASS before changes.

- [x] **Step 3: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c2-capture-relevance-v2.md
git commit -m "docs(codex): start track c c2 capture relevance"
```

---

## Task C2.1: Capture Reason Contract

**Files:**
- Modify: `packages/codex/src/types.ts`
- Modify: `packages/codex/src/relevance.ts`
- Modify: `packages/codex/tests/capture.test.ts`
- Modify: `packages/codex/tests/core-compat.test.ts`

- [x] **Step 1: Write failing reason contract tests**

Assert allowed reasons include:

- `style`
- `constraint`
- `rejected_alternative`
- `validation_fact`
- `release_context`

Run:

```bash
npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/core-compat.test.ts
```

Expected: FAIL until enum is expanded and passed through.

- [x] **Step 2: Expand types and pass-through mapping**

Update `CodexCaptureReason`. Ensure `inbox-event.ts` serializes `capture_reason` unchanged for bounded redacted events.

- [x] **Step 3: Verify compatibility**

Run:

```bash
npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/core-compat.test.ts
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/codex/src/types.ts packages/codex/src/inbox-event.ts packages/codex/tests/capture.test.ts packages/codex/tests/core-compat.test.ts
git commit -m "feat(codex): expand capture reason contract"
```

---

## Task C2.2: Relevance Classifier v2

**Files:**
- Modify: `packages/codex/src/relevance.ts`
- Modify: `packages/codex/tests/relevance.test.ts`

- [x] **Step 1: Write failing relevance tests**

Cover RU/EN examples:

- decisions are kept
- preferences/style are kept
- constraints are kept
- rejected alternatives are kept
- validation facts are kept
- off-topic learning and small talk are dropped
- assistant root-cause/fix summaries are kept

Run:

```bash
npm test -- packages/codex/tests/relevance.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement pattern families**

Use small, readable regex arrays by reason. Keep default behavior conservative:

- user general context may be kept when not noise
- assistant general context should still be filtered unless it has high-value markers

- [x] **Step 3: Verify classifier**

Run:

```bash
npm test -- packages/codex/tests/relevance.test.ts packages/codex/tests/capture.test.ts
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/codex/src/relevance.ts packages/codex/tests/relevance.test.ts packages/codex/tests/capture.test.ts
git commit -m "feat(codex): classify high value recall snippets"
```

---

## Task C2.3: Per-Reason Snippet Limits

**Files:**
- Modify: `packages/codex/src/bounded-snippets.ts`
- Modify: `packages/codex/tests/bounded-snippets.test.ts`

- [x] **Step 1: Write failing snippet limit tests**

Assert:

- `bug_context` allows more text than `style`
- `validation_fact` keeps enough command/test result context
- every reason respects a global hard max
- sentence bounds still prevent transcript dumps

Run:

```bash
npm test -- packages/codex/tests/bounded-snippets.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement per-reason limits**

Keep a constant map:

```ts
const SNIPPET_LIMITS_BY_REASON = {
  style: { chars: 180, sentences: 1 },
  preference: { chars: 220, sentences: 1 },
  bug_context: { chars: 600, sentences: 4 },
  validation_fact: { chars: 500, sentences: 3 },
} satisfies Partial<Record<CodexCaptureReason, SnippetLimit>>;
```

Use a global hard maximum regardless of reason.

- [x] **Step 3: Verify snippet behavior**

Run:

```bash
npm test -- packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/inbox-event.test.ts
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/codex/src/bounded-snippets.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/inbox-event.test.ts
git commit -m "feat(codex): bound snippets by capture reason"
```

---

## Task C2.4: Redaction v2

**Files:**
- Modify: `packages/codex/src/capture.ts`
- Create: `packages/codex/tests/redaction.test.ts`
- Modify: `packages/codex/tests/capture.test.ts`
- Modify: `packages/codex/tests/inbox-event.test.ts`

- [x] **Step 1: Write failing redaction tests**

Cover:

- bearer token
- `sk-` token
- npm token
- GitHub token
- `password=...`
- `api_key: ...`
- private key block marker
- boolean `redactionApplied` annotation

Run:

```bash
npm test -- packages/codex/tests/redaction.test.ts packages/codex/tests/inbox-event.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement best-effort redaction**

Keep the comment explicit: best effort, not a complete DLP guarantee. Return metadata indicating whether text changed.

- [x] **Step 3: Thread `redactionApplied` through capture**

Add `redactionApplied` to retained redacted/full user/assistant/session summary payloads where relevant.

- [x] **Step 4: Verify redaction**

Run:

```bash
npm test -- packages/codex/tests/redaction.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/core-compat.test.ts
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add packages/codex/src/capture.ts packages/codex/tests/redaction.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/core-compat.test.ts
git commit -m "feat(codex): strengthen redacted secret filtering"
```

---

## Task C2.5: Importer Acceptance For Redacted v2

**Files:**
- Modify: `packages/codex/tests/importer.test.ts`
- Modify: `packages/codex/tests/core-compat.test.ts`

- [x] **Step 1: Add redacted fixture-style tests**

Build JSONL records that include:

- RU decision
- rejected alternative
- assistant validation summary
- off-topic learning question
- secret-bearing prompt

Run:

```bash
npm test -- packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts
```

Expected: FAIL until all C2 changes are wired.

- [x] **Step 2: Fix capture/import integration**

Ensure retained events write expected `capture_reason`, redaction metadata, and bounded payloads.

- [x] **Step 3: Verify focused Codex tests**

Run:

```bash
npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/redaction.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/codex/src packages/codex/tests
git commit -m "feat(codex): retain richer redacted recall context"
```

---

## Task C2.6: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c2-capture-relevance-v2.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [x] **Step 1: Run validation**

Run:

```bash
npm test -- packages/codex/tests/capture.test.ts packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/redaction.test.ts packages/codex/tests/inbox-event.test.ts packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts
npm -w @locus/codex run typecheck
git diff --check
```

Expected: PASS.

- [x] **Step 2: Update checkboxes and commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c2-capture-relevance-v2.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c2 validation"
```

- [x] **Step 3: Create checkpoint tag**

Run:

```bash
git tag -a track-c-c2-local -m "Track C C2 capture relevance v2 local checkpoint"
```
