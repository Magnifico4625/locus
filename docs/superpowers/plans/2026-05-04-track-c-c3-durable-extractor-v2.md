# Track C C3 Durable Extractor v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract durable decisions, preferences, style, constraints, rejected alternatives, next steps, and validation facts from retained Codex conversation events with language-normalized topic keys.

**Architecture:** Keep extraction local and deterministic. Extend the existing durable memory types and extractor candidate model, add a topic-key registry with RU/EN synonym mapping, and update merge semantics without changing the database schema unless tests prove it necessary.

**Tech Stack:** TypeScript, Vitest, existing `durable_memories` table, `evidence_json`, existing `DurableMemoryStore`, no LLM dependency.

---

## Scope

In scope:

- new durable memory types
- pattern-family extraction
- confidence/evidence metadata
- low-confidence candidate drop
- language-normalized canonical English topic keys
- merge/supersede semantics for more memory types

Out of scope:

- UI/dashboard
- automatic deletion
- hooks
- schema migration unless absolutely required

## File Structure

Create:

- `packages/core/src/memory/extractor-patterns.ts`
- `packages/core/src/memory/topic-key-registry.ts`
- `packages/core/tests/memory/topic-key-registry.test.ts`

Modify:

- `packages/core/src/types.ts`
- `packages/core/src/memory/topic-keys.ts`
- `packages/core/src/memory/durable-extractor.ts`
- `packages/core/src/memory/durable-merge.ts`
- `packages/core/src/memory/durable-runner.ts`
- `packages/core/tests/memory/topic-keys.test.ts`
- `packages/core/tests/memory/durable-extractor.test.ts`
- `packages/core/tests/memory/durable-merge.test.ts`
- `packages/core/tests/memory/durable-runner.test.ts` if present or add coverage through existing integration tests

Do not modify:

- `packages/codex/**` except fixture tests if required in C6
- `packages/claude-code/**`

---

## Task C3.0: Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c3-durable-extractor-v2.md`

- [x] **Step 1: Verify C2 checkpoint**

Run:

```bash
git status --short --branch
git tag --list "track-c-c2-local"
```

Expected: clean tree and C2 tag exists unless intentionally skipped.

- [x] **Step 2: Run existing durable tests**

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/topic-keys.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c3-durable-extractor-v2.md
git commit -m "docs(codex): start track c c3 durable extractor"
```

---

## Task C3.1: Durable Memory Type Contract

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/tests/memory/durable-extractor.test.ts`
- Modify: `packages/core/tests/tools/review.test.ts`

- [x] **Step 1: Write failing type usage tests**

Add tests that insert or extract:

- `rejected_alternative`
- `next_step`
- `validation_fact`

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/tools/review.test.ts
```

Expected: FAIL until union type allows new memory types.

- [x] **Step 2: Extend `DurableMemoryType`**

Add:

- `rejected_alternative`
- `next_step`
- `validation_fact`

No migration should be necessary because `memory_type` is stored as text.

- [x] **Step 3: Verify type contract**

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/tools/review.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS or extractor-specific tests fail until later tasks.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/types.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/tools/review.test.ts
git commit -m "feat(core): extend durable memory types"
```

---

## Task C3.2: Topic Key Registry With RU/EN Mapping

**Files:**
- Create: `packages/core/src/memory/topic-key-registry.ts`
- Modify: `packages/core/src/memory/topic-keys.ts`
- Create: `packages/core/tests/memory/topic-key-registry.test.ts`
- Modify: `packages/core/tests/memory/topic-keys.test.ts`

- [x] **Step 1: Write failing topic registry tests**

Assert:

- `Decided to use PostgreSQL` => `database_choice`
- `Мы решили использовать PostgreSQL` => `database_choice`
- `отказались от hook-first capture` => `codex_hooks_strategy`
- `prefer one task at a time` => `user_workflow_style`
- unknown low-confidence mapping returns `undefined`
- no translated key such as `выбор_базы` is generated

Run:

```bash
npm test -- packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/memory/topic-keys.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement registry**

Use canonical English topic keys and RU/EN synonym lists. Keep registry data close to matcher logic so it is reviewable.

- [x] **Step 3: Keep legacy `deriveTopicKey()` API**

Make `topic-keys.ts` delegate to registry so existing imports do not break.
Mark the old function as a compatibility wrapper with a short `@deprecated`
comment pointing new code to `topic-key-registry.ts`; do not maintain two
parallel implementations.

- [x] **Step 4: Verify registry**

Run:

```bash
npm test -- packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/memory/topic-keys.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

Run:

```bash
git add packages/core/src/memory/topic-key-registry.ts packages/core/src/memory/topic-keys.ts packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/memory/topic-keys.test.ts
git commit -m "feat(core): normalize durable topic keys"
```

---

## Task C3.3: Pattern-Family Extractor

**Files:**
- Create: `packages/core/src/memory/extractor-patterns.ts`
- Modify: `packages/core/src/memory/durable-extractor.ts`
- Modify: `packages/core/tests/memory/durable-extractor.test.ts`

- [x] **Step 1: Write failing extractor tests**

Cover RU/EN:

- accepted decision
- rejected alternative with rationale
- preference
- collaboration style
- constraint
- next step
- validation fact
- low-confidence vague statement is dropped

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement pattern families**

Implement extraction helpers by memory type. Return candidate evidence:

- `eventId`
- `kind`
- `timestamp`
- `sessionId`
- `matchedPattern`
- `confidence`
- `reason`

Low-confidence candidates should not be returned.

- [x] **Step 3: Verify extraction**

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/topic-key-registry.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/core/src/memory/extractor-patterns.ts packages/core/src/memory/durable-extractor.ts packages/core/tests/memory/durable-extractor.test.ts
git commit -m "feat(core): extract richer durable memories"
```

---

## Task C3.4: Merge And Supersede Semantics

**Files:**
- Modify: `packages/core/src/memory/durable-merge.ts`
- Modify: `packages/core/src/memory/durable-runner.ts`
- Modify: `packages/core/tests/memory/durable-merge.test.ts`

- [ ] **Step 1: Write failing merge tests**

Assert:

- duplicate normalized summary confirms existing memory
- same-topic `decision` supersedes older active decision
- same-topic `preference` supersedes older active preference
- same-topic `constraint` supersedes older active constraint
- same-topic `next_step` supersedes older active next step
- `rejected_alternative` does not supersede by default
- topic collision keeps both if mapping confidence is absent

Run:

```bash
npm test -- packages/core/tests/memory/durable-merge.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement merge policy**

Keep policy explicit:

```ts
const SUPERSEDABLE_TYPES = new Set(['decision', 'preference', 'constraint', 'next_step']);
```

Do not supersede entries without topic keys unless current behavior explicitly expects it.

- [ ] **Step 3: Verify durable runner integration**

Run:

```bash
npm test -- packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/durable-extractor.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/src/memory/durable-merge.ts packages/core/src/memory/durable-runner.ts packages/core/tests/memory/durable-merge.test.ts
git commit -m "feat(core): merge durable memories by topic policy"
```

---

## Task C3.5: C1 Recall Compatibility With New Durable Types

**Files:**
- Modify: `packages/core/tests/tools/recall.test.ts`
- Modify: `packages/core/tests/integration/recall-tool.test.ts`
- Modify: `packages/core/src/recall/candidate-loader.ts` if needed
- Modify: `packages/core/src/recall/scoring.ts` if needed

- [ ] **Step 1: Write failing recall tests for new types**

Assert recall can answer:

- rejected alternative question
- next-step question
- validation question
- style/preference question

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts
```

Expected: FAIL if C1 loader/scoring only handles old memory types.

- [ ] **Step 2: Update loader/scoring minimally**

Map query intents to the new durable memory types explicitly:

- `rejected_alternative` for "why did we reject/отказались" questions
- `next_step` for "what remains/что осталось" questions
- `validation_fact` for "what was verified/какие проверки" questions
- `style`, `preference`, and `constraint` for user workflow and rule questions

Keep this as a small compatibility extension to the C1 loader/scoring, not a
rewrite of the recall engine.

- [ ] **Step 3: Verify recall and durable tests**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/src/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts
git commit -m "feat(core): recall richer durable memory types"
```

---

## Task C3.6: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c3-durable-extractor-v2.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [ ] **Step 1: Run validation**

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/topic-keys.test.ts packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts
npm -w @locus/core run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Update checkboxes and commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c3-durable-extractor-v2.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c3 validation"
```

- [ ] **Step 3: Create checkpoint tag**

Run:

```bash
git tag -a track-c-c3-local -m "Track C C3 durable extractor v2 local checkpoint"
```
