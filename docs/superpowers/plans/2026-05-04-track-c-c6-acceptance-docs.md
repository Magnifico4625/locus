# Track C C6 Acceptance And Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Track C recall quality with redacted-mode fixtures and update public docs so Locus promises only what is validated.

**Architecture:** Add Track C fixtures under `packages/codex/tests/fixtures/track-c/`, exercise them through the real server/import/inbox/durable/recall path, then update docs, roadmap, acceptance matrix, skill instructions, release notes, and landing page.

**Tech Stack:** TypeScript, Vitest, npm workspaces, Codex JSONL fixtures, MCP server tool registry tests, Markdown docs, GitHub Pages static HTML tests.

---

## Scope

In scope:

- Track C acceptance fixtures
- integration tests proving semantic recall
- docs truth pass
- plugin skill instructions
- release notes draft for `v3.6.0`
- local runtime smoke checklist
- final validation and checkpoint

Out of scope:

- dashboard
- secondary IDE adapters
- official desktop parity claim without testing

## File Structure

Create:

- `packages/codex/tests/fixtures/track-c/multi-task-russian.jsonl`
- `packages/codex/tests/fixtures/track-c/decision-rejected-alternative.jsonl`
- `packages/codex/tests/fixtures/track-c/style-preference-validation.jsonl`
- `packages/core/tests/integration/track-c-recall-acceptance.test.ts`
- `docs/releases/v3.6.0.md`

Modify:

- `README.md`
- `packages/codex/README.md`
- `plugins/locus-memory/skills/locus-memory/SKILL.md`
- `packages/codex/skills/locus-memory/SKILL.md`
- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`
- `docs/index.html`
- `packages/codex/tests/landing-page.test.ts`
- `CHANGELOG.md`

Do not modify:

- `packages/claude-code/**`

---

## Task C6.0: Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md`

- [ ] **Step 1: Verify C4 or C5 checkpoint**

Run:

```bash
git status --short --branch
git tag --list "track-c-c4-local"
git tag --list "track-c-c5-local"
```

Expected: clean tree. C4 tag must exist. C5 tag may be absent if hooks slipped.

- [ ] **Step 2: Run current acceptance tests**

Run:

```bash
npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md
git commit -m "docs(codex): start track c c6 acceptance docs"
```

---

## Task C6.1: Track C Fixtures

**Files:**
- Create: `packages/codex/tests/fixtures/track-c/multi-task-russian.jsonl`
- Create: `packages/codex/tests/fixtures/track-c/decision-rejected-alternative.jsonl`
- Create: `packages/codex/tests/fixtures/track-c/style-preference-validation.jsonl`

- [ ] **Step 1: Create fixture outlines**

Fixtures must include realistic Codex JSONL shapes already supported by normalizer:

- `event_msg` user messages
- `response_item` assistant messages
- `event_msg` `task_complete`

Do not include real secrets. Use fake tokens only for redaction tests.

- [ ] **Step 2: Cover required scenarios**

Fixtures must include:

- multiple Russian tasks on the same day
- capture strategy decision
- hook-first rejected alternative and rationale
- user workflow/style preference
- npm install or package validation fact
- next step
- off-topic learning/noise turn

- [ ] **Step 3: Commit fixtures**

Run:

```bash
git add packages/codex/tests/fixtures/track-c
git commit -m "test(codex): add track c recall fixtures"
```

---

## Task C6.2: End-To-End Recall Acceptance

**Files:**
- Create: `packages/core/tests/integration/track-c-recall-acceptance.test.ts`

- [ ] **Step 1: Write failing acceptance tests**

Use `createServer()` with temp `CODEX_HOME`, copy fixture files under `sessions/YYYY/MM/`, set:

```text
LOCUS_CODEX_CAPTURE=redacted
LOCUS_CAPTURE_LEVEL=redacted
```

Assert these tool calls:

- `memory_recall({ question: "что мы делали вчера?" })`
- `memory_recall({ question: "что решили по capture strategy?" })`
- `memory_recall({ question: "почему отказались от hook-first?" })`
- `memory_recall({ question: "какой у меня стиль работы?" })`
- `memory_recall({ question: "какие ошибки были при npm install?" })`
- `memory_recall({ question: "что осталось сделать?" })`
- `memory_recall({ question: "что реально проверено?" })`

Run:

```bash
npm test -- packages/core/tests/integration/track-c-recall-acceptance.test.ts
```

Expected: FAIL until all C1-C4 behavior is correct.

- [ ] **Step 2: Fix only acceptance gaps**

If tests fail because C1-C4 missed a small behavior, patch the relevant focused module with a regression test. Do not rewrite architecture in C6.

- [ ] **Step 3: Verify Track C acceptance**

Run:

```bash
npm test -- packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/src packages/core/tests packages/codex/tests/fixtures/track-c
git commit -m "test(core): prove track c redacted recall"
```

---

## Task C6.3: Skill Instructions Truth Pass

**Files:**
- Modify: `packages/codex/skills/locus-memory/SKILL.md`
- Modify: `plugins/locus-memory/skills/locus-memory/SKILL.md`
- Modify: `packages/codex/tests/plugin-bundle.test.ts` if needed

- [ ] **Step 1: Update skill behavior**

The skill should tell Codex:

- use `memory_recall` before saying it does not remember
- use `candidateGroups` to ask a focused clarification question
- prefer `memory_review` for "what did you store" questions
- distinguish `metadata`, `redacted`, `full`
- do not overclaim desktop parity

- [ ] **Step 2: Verify bundled skill sync tests**

Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts packages/codex/tests/skill-sync.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add packages/codex/skills/locus-memory/SKILL.md plugins/locus-memory/skills/locus-memory/SKILL.md packages/codex/tests/plugin-bundle.test.ts
git commit -m "docs(codex): teach skill richer recall flow"
```

---

## Task C6.4: Product Docs Truth Pass

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `docs/codex-acceptance-matrix.md`
- Modify: `docs/roadmap/codex-next.md`
- Modify: `docs/index.html`
- Modify: `packages/codex/tests/landing-page.test.ts`
- Create: `docs/releases/v3.6.0.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write/update docs tests**

Assert landing page and docs mention:

- `redacted` as recommended rich recall mode
- Track C recall quality only after acceptance passes
- `full` warning
- hooks optional if shipped
- desktop parity unverified unless tested

Run:

```bash
npm test -- packages/codex/tests/landing-page.test.ts
```

Expected: FAIL until docs are updated.

- [ ] **Step 2: Update README and Codex docs**

Keep install quick start intact. Add richer recall section with examples and privacy wording.

- [ ] **Step 3: Update acceptance matrix and roadmap**

Mark Track C status accurately:

- in-progress until final validation
- shipped only after release prep

- [ ] **Step 4: Add `docs/releases/v3.6.0.md`**

Include:

- what changed
- validation evidence
- known limitations
- hooks status
- desktop parity status

- [ ] **Step 5: Verify docs search**

Run:

```bash
rg -n "metadata|redacted|full|candidateGroups|hook|desktop|v3.6|Track C" README.md packages/codex/README.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md docs/index.html docs/releases/v3.6.0.md
```

Expected: no stale or contradictory product claims.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- packages/codex/tests/landing-page.test.ts
git diff --check
```

Expected: PASS.

Commit:

```bash
git add README.md packages/codex/README.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md docs/index.html packages/codex/tests/landing-page.test.ts docs/releases/v3.6.0.md CHANGELOG.md
git commit -m "docs(codex): document richer recall release"
```

---

## Task C6.5: Full Validation

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [ ] **Step 1: Run focused validation**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/codex/tests/capture.test.ts packages/codex/tests/relevance.test.ts packages/codex/tests/bounded-snippets.test.ts packages/codex/tests/redaction.test.ts packages/codex/tests/importer.test.ts packages/codex/tests/core-compat.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run workspace validation**

Run:

```bash
npm run build
npm run check
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Local runtime recall smoke**

In a real Codex session after installing the local build or package candidate, ask:

```text
memory_status
memory_recall: "что мы делали вчера?"
memory_recall: "какой у меня стиль работы?"
memory_review
memory_audit
```

Expected:

- capture level is `redacted`
- recall returns useful results or honest clarification
- review/audit show why memories were stored

- [ ] **Step 4: Update validation notes and commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c6 validation"
```

- [ ] **Step 5: Create checkpoint tag**

Run:

```bash
git tag -a track-c-c6-local -m "Track C C6 acceptance docs local checkpoint"
```

---

## Task C6.6: Release Readiness Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md`

- [ ] **Step 1: Summarize release state**

Record:

- tests run
- runtime checks run
- known limitations
- whether C5 hooks shipped or slipped
- whether desktop parity remains unverified

- [ ] **Step 2: Ask for release approval**

Do not bump versions or publish until the user approves moving from Track C implementation to release prep.
