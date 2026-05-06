# Track C C1 Recall Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace simple `memory_recall` substring lookup with a backward-compatible recall engine that understands RU/EN time phrases, intent, scoring, and candidate groups.

**Architecture:** Add focused modules under `packages/core/src/recall/` and keep `packages/core/src/tools/recall.ts` as a thin MCP-facing wrapper. The engine loads durable and conversation candidates, scores them, groups ambiguous work, and returns optional fields while preserving the existing `MemoryRecallResult` shape.

**Tech Stack:** TypeScript, Vitest, existing `DatabaseAdapter`, existing `TimeRange` and conversation/durable tables, no new runtime dependency.

---

## Scope

In scope:

- RU/EN temporal parser
- RU/EN intent parser
- candidate loading from durable memories and conversation events
- scoring and grouping
- optional `candidateGroups`, `matchedIntent`, `matchedTopics`, `confidence`
- compatibility with existing callers and tests

Out of scope:

- capture/relevance changes
- durable extractor changes
- hook support
- schema migrations

## File Structure

Create:

- `packages/core/src/recall/temporal-parser.ts`
- `packages/core/src/recall/query-parser.ts`
- `packages/core/src/recall/candidate-loader.ts`
- `packages/core/src/recall/scoring.ts`
- `packages/core/src/recall/grouping.ts`
- `packages/core/src/recall/result-builder.ts`
- `packages/core/src/recall/index.ts`
- `packages/core/tests/recall/temporal-parser.test.ts`
- `packages/core/tests/recall/query-parser.test.ts`
- `packages/core/tests/recall/scoring.test.ts`
- `packages/core/tests/recall/grouping.test.ts`

Modify:

- `packages/core/src/tools/recall.ts`
- `packages/core/src/types.ts`
- `packages/core/tests/tools/recall.test.ts`
- `packages/core/tests/integration/recall-tool.test.ts`
- `packages/core/tests/integration/track-a-recall-acceptance.test.ts` only if compatibility expectations need explicit coverage

Do not modify:

- `packages/codex/**`
- `packages/claude-code/**`
- storage migrations

---

## Task C1.0: Baseline Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md`

- [x] **Step 1: Verify clean branch**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: clean tree, latest planning commits present.

- [x] **Step 2: Create baseline tag if not already present**

Run:

```bash
git tag -a track-c-baseline-2026-05-04 -m "Track C baseline before recall engine v2"
```

Expected: tag created. If it already exists, do not recreate it.

- [x] **Step 3: Run current recall tests**

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
```

Expected: PASS before changes.

- [x] **Step 4: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): start track c c1 recall engine"
```

Expected: docs-only checkpoint if checkboxes changed.

---

## Task C1.1: Recall Result Contract

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/tools/recall.test.ts`

- [x] **Step 1: Write failing contract tests**

Add assertions that `memory_recall` can include optional fields while old fields remain:

```ts
expect(result).toMatchObject({
  status: 'needs_clarification',
  question: expect.any(String),
  summary: expect.any(String),
  candidates: expect.any(Array),
  candidateGroups: expect.any(Array),
});
```

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
```

Expected: FAIL because `candidateGroups` does not exist.

- [x] **Step 2: Extend TypeScript types only**

Add optional types:

- `MemoryRecallIntent`
- `MemoryRecallConfidence`
- `MemoryRecallCandidateGroup`
- optional fields on `MemoryRecallCandidate`
- optional fields on `MemoryRecallResult`

Keep existing required fields unchanged.

- [x] **Step 3: Run typecheck and tests**

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS or only test still failing until later tasks if test requires behavior.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/types.ts packages/core/tests/tools/recall.test.ts
git commit -m "feat(core): extend recall result contract"
```

---

## Task C1.2: RU/EN Temporal Parser

**Files:**
- Create: `packages/core/src/recall/temporal-parser.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Create: `packages/core/tests/recall/temporal-parser.test.ts`

- [x] **Step 1: Write failing temporal parser tests**

Cover:

- `today`
- `yesterday`
- `last week`
- `5 days ago`
- `сегодня`
- `вчера`
- `на прошлой неделе`
- `5 дней назад`
- `что делали в пятницу`

Use a fixed numeric `now`, for example:

```ts
const now = Date.parse('2026-05-04T12:00:00.000Z');
```

Run:

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts
```

Expected: FAIL because parser does not exist.

- [x] **Step 2: Implement deterministic parser**

Implement:

```ts
export function parseRecallTemporalRange(question: string, now: number): ParsedRecallRange | undefined
```

Use existing `resolveTimeRange()` for `today`, `yesterday`, and `last_7d` where possible. For `N days ago`, compute day boundaries in UTC first. Keep timezone behavior explicit in tests.

- [x] **Step 3: Verify parser**

Run:

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/recall/temporal-parser.ts packages/core/src/tools/recall.ts packages/core/tests/recall/temporal-parser.test.ts
git commit -m "feat(core): parse recall time ranges"
```

---

## Task C1.3: RU/EN Query Intent Parser

**Files:**
- Create: `packages/core/src/recall/query-parser.ts`
- Create: `packages/core/tests/recall/query-parser.test.ts`

- [x] **Step 1: Write failing intent tests**

Cover questions for intents:

- `decision`
- `work_summary`
- `bug_context`
- `preference_style`
- `rejected_alternative`
- `next_step`
- `validation_fact`
- `general`

Include RU and EN examples.

Run:

```bash
npm test -- packages/core/tests/recall/query-parser.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement parser**

Implement:

```ts
export function parseRecallQuery(question: string, now: number): ParsedRecallQuery
```

Return:

- normalized terms
- stop-word-filtered terms
- RU stem-lite term variants for common morphology, for example
  `ошибки` / `ошибку` / `ошибка` -> `ошибк`
- intent
- temporal range from C1.2
- topic hints, if obvious

Do not overfit to Locus-only terms; keep this deterministic and small. Do not
add Snowball, Porter, or another stemming dependency in C1.

- [x] **Step 3: Verify parser**

Run:

```bash
npm test -- packages/core/tests/recall/query-parser.test.ts packages/core/tests/recall/temporal-parser.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/recall/query-parser.ts packages/core/tests/recall/query-parser.test.ts
git commit -m "feat(core): parse recall query intent"
```

---

## Task C1.4: Candidate Loading

**Files:**
- Create: `packages/core/src/recall/candidate-loader.ts`
- Create: `packages/core/src/recall/index.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Test: `packages/core/tests/tools/recall.test.ts`

Note: `packages/core/src/recall/` is new in Track C. This task creates
`candidate-loader.ts` for the first time; later C1/C3 tasks may modify it after
that initial creation.

- [x] **Step 1: Write failing candidate loader tests**

Set up in-memory DB rows for:

- durable `decision`
- durable `preference`
- durable `style`
- durable `constraint`
- conversation `user_prompt`
- conversation `ai_response`
- conversation `session_end`

Assert intent-specific loading prefers relevant memory types.

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement loader**

Implement loaders:

- active durable memories by memory type and optional topic
- conversation events by time range and term match
- timeline fallback when terms are empty

Use parameterized SQL. Do not introduce N+1 event file queries.

For conversation FTS, do not rely on the existing quoted `sanitizeFtsQuery()`
behavior for recall morphology. Add a recall-specific FTS query builder that
can use safe prefix terms such as `ошибк*` for normalized RU stems. If FTS5 is
unavailable, fall back to `LIKE` over normalized term variants.

- [x] **Step 3: Verify loader through recall tests**

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS for loader-specific expectations.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/recall/candidate-loader.ts packages/core/src/recall/index.ts packages/core/src/tools/recall.ts packages/core/tests/tools/recall.test.ts
git commit -m "feat(core): load recall candidates by intent"
```

---

## Task C1.5: Scoring And Grouping

**Files:**
- Create: `packages/core/src/recall/scoring.ts`
- Create: `packages/core/src/recall/grouping.ts`
- Create: `packages/core/src/recall/result-builder.ts`
- Modify: `packages/core/src/recall/candidate-loader.ts`
- Modify: `packages/core/src/recall/index.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/tests/recall/scoring.test.ts`
- Create: `packages/core/tests/recall/grouping.test.ts`
- Modify: `packages/core/tests/tools/recall.test.ts`

- [x] **Step 1: Write failing scoring tests**

Assert higher scores for:

- intent/memory type match
- exact topic key match
- recent event
- durable memory over raw conversation for decision/style questions
- `captureReason` matching intent

Run:

```bash
npm test -- packages/core/tests/recall/scoring.test.ts
```

Expected: FAIL.

- [x] **Step 2: Write failing grouping tests**

Assert:

- multiple sessions become multiple groups
- same session/topic merges into one group
- `needs_clarification` exposes concise headings

Run:

```bash
npm test -- packages/core/tests/recall/grouping.test.ts
```

Expected: FAIL.

- [x] **Step 3: Implement scoring**

Keep weights simple constants in `scoring.ts`. Do not tune against only one fixture.

- [x] **Step 4: Implement grouping and result builder**

Rules:

- one strong group => `ok`
- multiple close groups => `needs_clarification`
- none => `no_memory`

Return optional `candidateGroups` immediately.

- [x] **Step 5: Verify scoring/grouping**

Run:

```bash
npm test -- packages/core/tests/recall/scoring.test.ts packages/core/tests/recall/grouping.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 6: Commit**

Run:

```bash
git add packages/core/src/recall/scoring.ts packages/core/src/recall/grouping.ts packages/core/src/recall/result-builder.ts packages/core/tests/recall/scoring.test.ts packages/core/tests/recall/grouping.test.ts
git commit -m "feat(core): score and group recall candidates"
```

---

## Task C1.6: Wire `memory_recall`

**Files:**
- Create: `packages/core/src/recall/engine.ts`
- Modify: `packages/core/src/recall/candidate-loader.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Create/Modify: `packages/core/src/recall/index.ts`
- Modify: `packages/core/src/recall/query-parser.ts`
- Modify: `packages/core/src/recall/result-builder.ts`
- Modify: `packages/core/src/recall/scoring.ts`
- Modify: `packages/core/tests/recall/grouping.test.ts`
- Modify: `packages/core/tests/recall/query-parser.test.ts`
- Modify: `packages/core/tests/recall/scoring.test.ts`
- Modify: `packages/core/tests/tools/recall.test.ts`
- Modify: `packages/core/tests/integration/recall-tool.test.ts`
- Modify: `packages/core/tests/integration/track-a-recall-acceptance.test.ts`

- [x] **Step 1: Write integration expectations**

Add tests for:

- RU `что мы делали вчера?`
- style/preference query returns durable candidate
- multiple groups returns `needs_clarification` with `candidateGroups`
- existing Track A bugfix recall remains `ok`

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
```

Expected: FAIL before wiring.

- [x] **Step 2: Replace old recall implementation with engine call**

Keep `handleRecall()` exported with same signature. Internally call `runRecallEngine()`.

- [x] **Step 3: Verify focused recall tests**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/recall packages/core/src/tools/recall.ts packages/core/src/types.ts packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
git commit -m "feat(core): wire recall engine v2"
```

---

## Task C1.7: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [x] **Step 1: Run focused validation**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
npm -w @locus/core run typecheck
git diff --check
```

Expected: PASS and clean diff check.

- [x] **Step 2: Update plan checkboxes**

Mark completed C1 tasks in this file and bundle checkpoint.

- [x] **Step 3: Commit validation notes**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c1 validation"
```

- [x] **Step 4: Create checkpoint tag**

Run:

```bash
git tag -a track-c-c1-local -m "Track C C1 recall engine v2 local checkpoint"
```
