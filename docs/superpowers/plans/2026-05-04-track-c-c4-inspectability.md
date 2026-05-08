# Track C C4 Inspectability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make richer memory inspectable so users can see what Locus stored, why it was stored, where it came from, and how to remove it.

**Architecture:** Reuse existing durable `evidence_json` and conversation payload annotations. Extend review/audit/status/doctor outputs with optional fields and filters; avoid schema migrations unless tests show JSON evidence is insufficient.

**Tech Stack:** TypeScript, Vitest, existing MCP tools, existing durable memory store, existing audit/status/doctor tools.

---

## Scope

In scope:

- `memory_review` filters and output improvements
- `memory_audit` capture/reason visibility
- `memory_status` recall truth refinements
- `memory_doctor` warnings for capture/readiness
- docs snippets for review/delete flow

Out of scope:

- dashboard UI
- automatic deletion
- new DB schema
- hooks

## File Structure

Create:

- `packages/core/src/memory/evidence.ts`
- `packages/core/tests/memory/evidence.test.ts`

`evidence.ts` is an output helper for existing `Record<string, unknown>`
durable evidence. It must safely normalize and format `evidence_json`-derived
objects for review/audit/doctor output; it must not introduce a new storage
model or replace `DurableMemoryEntry.evidence`.

Modify:

- `packages/core/src/types.ts`
- `packages/core/src/memory/review.ts`
- `packages/core/src/tools/review.ts`
- `packages/core/src/server.ts`
- `packages/core/src/tools/audit.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/tools/doctor.ts`
- `packages/core/tests/memory/review.test.ts`
- `packages/core/tests/tools/review.test.ts`
- `packages/core/tests/tools/audit.test.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/tools/doctor.test.ts`

Do not modify:

- `packages/codex/**` except docs/tests in C6
- `packages/claude-code/**`

---

## Task C4.0: Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c4-inspectability.md`

- [x] **Step 1: Verify C3 checkpoint**

Run:

```bash
git status --short --branch
git tag --list "track-c-c3-local"
```

Expected: clean tree and C3 tag exists unless intentionally skipped.

- [x] **Step 2: Run existing inspectability tests**

Run:

```bash
npm test -- packages/core/tests/tools/review.test.ts packages/core/tests/tools/audit.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/memory/review.test.ts
```

Expected: PASS.

- [x] **Step 3: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c4-inspectability.md
git commit -m "docs(codex): start track c c4 inspectability"
```

---

## Task C4.1: Evidence Parser

**Files:**
- Create: `packages/core/src/memory/evidence.ts`
- Create: `packages/core/tests/memory/evidence.test.ts`

- [ ] **Step 1: Write failing evidence tests**

Cover parsing evidence with:

- `confidence`
- `reason`
- `matchedPattern`
- `eventId`
- `sessionId`
- missing/invalid fields

Run:

```bash
npm test -- packages/core/tests/memory/evidence.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement safe evidence helpers**

Implement helpers that never throw on malformed JSON-derived evidence. The
helpers should normalize existing `Record<string, unknown>` values into concise
display fields such as confidence, reason, matched pattern, source event, and
session; they should not parse DB rows directly or become a new persistence
abstraction.

- [ ] **Step 3: Verify evidence helpers**

Run:

```bash
npm test -- packages/core/tests/memory/evidence.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/src/memory/evidence.ts packages/core/tests/memory/evidence.test.ts
git commit -m "feat(core): summarize durable memory evidence"
```

---

## Task C4.2: `memory_review` Filters And Why-Stored Output

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/memory/review.ts`
- Modify: `packages/core/src/tools/review.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/tests/memory/review.test.ts`
- Modify: `packages/core/tests/tools/review.test.ts`

- [ ] **Step 1: Write failing review tests**

Assert `memory_review` supports:

- `memoryType`
- `confidence`
- `topicKey`
- `state`
- output includes `sourceEventId`, `memoryType`, `confidence`, `whyStored`

Run:

```bash
npm test -- packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Extend types and tool schema**

Add optional filters. Keep existing response fields stable.

- [ ] **Step 3: Implement review formatting**

Build `whyStored` from evidence:

```text
Stored as decision because matched "решили" with high confidence from session <id>.
```

- [ ] **Step 4: Verify review**

Run:

```bash
npm test -- packages/core/tests/memory/evidence.test.ts packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/memory/review.ts packages/core/src/tools/review.ts packages/core/src/server.ts packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts
git commit -m "feat(core): expose why stored durable memories"
```

---

## Task C4.3: Audit Capture Visibility

**Files:**
- Modify: `packages/core/src/tools/audit.ts`
- Modify: `packages/core/tests/tools/audit.test.ts`

- [ ] **Step 1: Write failing audit tests**

Assert audit output mentions:

- capture mode
- redacted/full warning
- counts by capture reason when conversation payload contains `capture_reason`
- best-effort redaction wording

Run:

```bash
npm test -- packages/core/tests/tools/audit.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement audit summary**

Use lightweight SQL over `conversation_events.payload_json`. Avoid unbounded
full-table JSON parsing: inspect at most the latest 1000 Codex conversation
events, and prefer a recent time window such as the last 30 days when available.
Keep the limit as a named constant so future tuning is explicit.

- [ ] **Step 3: Verify audit**

Run:

```bash
npm test -- packages/core/tests/tools/audit.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/src/tools/audit.ts packages/core/tests/tools/audit.test.ts
git commit -m "feat(core): audit capture reasons"
```

---

## Task C4.4: Status And Doctor Truth

**Files:**
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/tools/doctor.ts`
- Modify: `packages/core/tests/tools/status.test.ts`
- Modify: `packages/core/tests/tools/doctor.test.ts`

- [ ] **Step 1: Write failing status/doctor tests**

Assert:

- `metadata` says weak recall
- `redacted` says recommended rich recall
- `full` says maximum recall and privacy warning
- doctor warns when redacted has zero retained conversation events
- desktop parity remains unverified

Run:

```bash
npm test -- packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
```

Expected: FAIL for new text/fields.

- [ ] **Step 2: Implement truth refinements**

Keep shape backward-compatible. Add optional diagnostic fields only if needed.

- [ ] **Step 3: Verify status/doctor**

Run:

```bash
npm test -- packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/core/src/tools/status.ts packages/core/src/tools/doctor.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
git commit -m "feat(core): clarify recall readiness diagnostics"
```

---

## Task C4.5: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c4-inspectability.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [ ] **Step 1: Run validation**

Run:

```bash
npm test -- packages/core/tests/memory/evidence.test.ts packages/core/tests/memory/review.test.ts packages/core/tests/tools/review.test.ts packages/core/tests/tools/audit.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts
npm -w @locus/core run typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Update checkboxes and commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c4-inspectability.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c4 validation"
```

- [ ] **Step 3: Create checkpoint tag**

Run:

```bash
git tag -a track-c-c4-local -m "Track C C4 inspectability local checkpoint"
```
