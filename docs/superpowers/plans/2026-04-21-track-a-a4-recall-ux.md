# Track A A4 Recall UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let users ask natural past-oriented questions such as "what did we do yesterday?" and receive a summary-first answer backed by Locus, without manually orchestrating raw memory tools.

**Architecture:** add a dedicated `memory_recall` MCP tool that resolves temporal ranges, gathers durable and recent conversation context, and returns candidate summaries with absolute dates. Pair that helper with Codex skill/prompt updates so the agent checks Locus before saying it does not remember. Keep the tool focused on recall orchestration, not on final prose generation.

**Tech Stack:** TypeScript, MCP tool contracts, Vitest, existing search and timeline helpers, Codex skill markdown and sync tests.

---

## Dependencies

- Requires `A3` checkpoint: `track-a-a3-local`
- Depends on durable memory being searchable
- Must not include cleanup logic from `A5`

## File Map

**Create:**
- `packages/core/src/tools/recall.ts`
- `packages/core/tests/tools/recall.test.ts`
- `packages/core/tests/integration/recall-tool.test.ts`

**Modify:**
- `packages/core/src/types.ts`
- `packages/core/src/server.ts`
- `packages/core/src/tools/search.ts`
- `packages/core/src/tools/timeline.ts`
- `packages/core/tests/integration/server.test.ts`
- `packages/codex/skills/locus-memory/SKILL.md`
- `packages/codex/tests/skill-contract.test.ts`
- `packages/codex/tests/skill-sync.test.ts`
- `scripts/sync-codex-skill.mjs`

## Recall Contract To Freeze

`memory_recall` should return a machine-friendly structure like:

```ts
{
  status: 'ok' | 'no_memory' | 'needs_clarification';
  question: string;
  resolvedRange?: {
    label: string;
    from: number;
    to: number;
    fromIso: string;
    toIso: string;
  };
  summary: string;
  candidates: Array<{
    sessionId?: string;
    headline: string;
    whyMatched: string;
    eventIds: string[];
    durableMemoryIds: number[];
  }>;
}
```

Rules:

- the tool returns data and summary scaffolding, not final polished assistant prose
- relative dates must be resolved to absolute date ranges
- ambiguity becomes `needs_clarification`, not a hallucinated answer
- the skill must tell the agent to use Locus before claiming memory loss

### Task 0: Branch From The A3 Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a4-recall-ux.md`

- [x] Verify the A3 checkpoint tag exists.

Run: `git tag --list track-a-a3-local`
Expected: prints `track-a-a3-local`.

- [x] Create the branch from the checkpoint.

Run: `git checkout track-a-a3-local`
Expected: detached HEAD at A3 checkpoint.

- [x] Create the feature branch.

Run: `git checkout -b feature/track-a-a4-recall-ux`
Expected: new branch created.

### Task 1: Freeze The Recall Tool Contract In Tests

**Files:**
- Create: `packages/core/tests/tools/recall.test.ts`
- Modify: `packages/core/src/types.ts`

- [x] Add failing tests defining:
  - `yesterday` resolves to an absolute date range
  - durable memory contributes to the summary
  - recent conversation context contributes to the summary
  - ambiguous matches return `needs_clarification`
  - no matches returns `no_memory`

- [x] Run the recall unit tests.

Run: `npm test -- packages/core/tests/tools/recall.test.ts`
Expected: FAIL because the recall helper does not exist yet.

- [x] Commit the failing recall tests.

Run: `git add packages/core/tests/tools/recall.test.ts packages/core/src/types.ts`
Expected: test contract staged.

- [x] Commit.

Run: `git commit -m "test(core): define memory recall tool contract"`
Expected: test-only commit created.

### Task 2: Implement Recall Orchestration Helper

**Files:**
- Create: `packages/core/src/tools/recall.ts`
- Modify: `packages/core/src/tools/search.ts`
- Modify: `packages/core/src/tools/timeline.ts`
- Modify: `packages/core/src/types.ts`

- [x] Implement `handleRecall()` as a pure helper that:
  - resolves time windows
  - queries durable memory
  - queries recent conversation context
  - groups related events into recall candidates
  - emits a summary-first structured result

- [x] Reuse `resolveTimeRange()` instead of inventing a second date resolver.

- [x] Re-run the recall unit tests.

Run: `npm test -- packages/core/tests/tools/recall.test.ts`
Expected: PASS.

- [x] Commit the helper implementation.

Run: `git add packages/core/src/tools/recall.ts packages/core/src/tools/search.ts packages/core/src/tools/timeline.ts packages/core/src/types.ts`
Expected: recall helper files staged.

- [x] Commit.

Run: `git commit -m "feat(core): add summary-first memory recall helper"`
Expected: implementation commit created.

### Task 3: Register `memory_recall` In The MCP Server

**Files:**
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/tests/integration/server.test.ts`
- Create: `packages/core/tests/integration/recall-tool.test.ts`

- [x] Add the `memory_recall` MCP tool with a concise schema:
  - `question: string`
  - `timeRange?: TimeRange`
  - `limit?: number`

- [x] Make the tool reuse the same pre-search Codex auto-import flow as `memory_search`.

- [x] Add integration tests proving the tool is exposed and returns structured JSON.

- [x] Run the recall integration tests.

Run: `npm test -- packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/server.test.ts`
Expected: PASS.

- [x] Commit the MCP wiring.

Run: `git add packages/core/src/server.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/server.test.ts`
Expected: recall tool wiring staged.

- [x] Commit.

Run: `git commit -m "feat(core): expose memory recall tool"`
Expected: implementation commit created.

### Task 4: Update Codex Skill And Skill Contract

**Files:**
- Modify: `packages/codex/skills/locus-memory/SKILL.md`
- Modify: `packages/codex/tests/skill-contract.test.ts`
- Modify: `packages/codex/tests/skill-sync.test.ts`
- Modify: `scripts/sync-codex-skill.mjs`

- [x] Update the canonical skill so it explicitly says:
  - use `memory_recall` first for past-work questions
  - fall back to `memory_search` / `memory_timeline` only when needed
  - do not say "I don't remember" before checking Locus
  - clarify ambiguous histories after lookup, not before

- [x] Extend the skill contract tests accordingly.

- [x] Re-run the skill tests.

Run: `npm test -- packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts`
Expected: PASS.

- [x] Commit the skill update.

Run: `git add packages/codex/skills/locus-memory/SKILL.md packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts scripts/sync-codex-skill.mjs`
Expected: skill and test changes staged.

- [x] Commit.

Run: `git commit -m "feat(codex): teach skill to use memory recall first"`
Expected: implementation commit created.

### Task 5: Add End-To-End Recall Acceptance Cases

**Files:**
- Create: `packages/core/tests/integration/recall-tool.test.ts`
- Modify: `packages/core/tests/tools/recall.test.ts`

- [ ] Add integration cases covering:
  - "what did we do yesterday?"
  - "what did we decide about auth last week?"
  - ambiguous two-task recall
  - empty-memory response

- [ ] Ensure returned ranges include ISO timestamps or equivalent absolute date evidence.

- [ ] Run the dedicated recall acceptance tests.

Run: `npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts`
Expected: PASS.

- [ ] Commit the recall acceptance coverage.

Run: `git add packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts`
Expected: recall acceptance tests staged.

- [ ] Commit.

Run: `git commit -m "test(core): cover natural-language recall flows"`
Expected: test commit created.

### Task 6: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a4-recall-ux.md`

- [ ] Run the A4 validation suite.

Run: `npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/recall-tool.test.ts packages/core/tests/integration/server.test.ts packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts`
Expected: PASS.

- [ ] Run workspace typecheck.

Run: `npm run typecheck`
Expected: PASS.

- [ ] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a4-recall-ux.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a4 validation"`
Expected: final A4 validation commit created.

- [ ] Tag the checkpoint.

Run: `git tag -a track-a-a4-local -m "Track A A4 recall UX local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- Users can ask natural temporal questions and get Locus-backed summary-first recall.
- Relative dates are surfaced as absolute ranges.
- The agent has explicit skill guidance to check Locus before claiming memory loss.
- Ambiguous recall becomes a clarifying flow instead of a guessed answer.
