# Track A A3 High-Value Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** automatically extract durable high-value memory from Codex conversation events so decisions, preferences, style, and stable constraints survive across sessions without manual `memory_remember`.

**Architecture:** introduce a dedicated durable-memory subsystem in `packages/core` instead of overloading the legacy `memories` semantic table. Extraction stays local and rule-based: it reads newly ingested conversation events, derives structured durable facts with Topic Keys, and stores them with deterministic merge and supersede rules. Search and the `memory://decisions` resource start reading the new durable store so A4 can build real recall on top of it.

**Tech Stack:** TypeScript, SQLite migrations, Vitest, existing conversation event store, FTS5 when available, MCP resources.

---

## Dependencies

- Requires `A2` checkpoint: `track-a-a2-local`
- Provides substrate for `A4` and `A5`
- Must not depend on docs or dashboard work

## File Map

**Create:**
- `packages/core/src/memory/durable.ts`
- `packages/core/src/memory/durable-extractor.ts`
- `packages/core/src/memory/topic-keys.ts`
- `packages/core/src/memory/durable-merge.ts`
- `packages/core/src/memory/durable-runner.ts`
- `packages/core/tests/memory/durable.test.ts`
- `packages/core/tests/memory/durable-extractor.test.ts`
- `packages/core/tests/memory/topic-keys.test.ts`
- `packages/core/tests/memory/durable-merge.test.ts`
- `packages/core/tests/integration/durable-extraction-flow.test.ts`

**Modify:**
- `packages/core/src/types.ts`
- `packages/core/src/storage/migrations.ts`
- `packages/core/src/tools/import-codex.ts`
- `packages/core/src/tools/search.ts`
- `packages/core/src/resources/decisions.ts`
- `packages/core/src/server.ts`
- `packages/core/tests/tools/import-codex.test.ts`
- `packages/core/tests/tools/search.test.ts`
- `packages/core/tests/resources/decisions.test.ts`
- `packages/core/tests/storage/migrations.test.ts`
- `packages/core/tests/integration/codex-import-tool.test.ts`
- `packages/core/tests/integration/server.test.ts`

## Durable Memory Contract To Freeze

Add a dedicated table and typed model shaped like:

```ts
{
  id: number;
  topicKey?: string;
  memoryType: 'decision' | 'preference' | 'style' | 'constraint';
  state: 'active' | 'stale' | 'superseded' | 'archivable';
  summary: string;
  evidenceJson: string;
  sourceEventId?: string;
  source: 'codex' | 'claude-code' | 'manual';
  supersededById?: number;
  createdAt: number;
  updatedAt: number;
}
```

Rules:

- Topic Keys are generated only when the extractor recognizes a stable decision family.
- Merge is deterministic, not embedding-model driven.
- Same Topic Key plus stronger newer evidence should supersede the older active entry.
- Search should surface durable entries as first-class results.

### Task 0: Branch From The A2 Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a3-high-value-extraction.md`

- [x] Verify the A2 checkpoint tag exists.

Run: `git tag --list track-a-a2-local`
Expected: prints `track-a-a2-local`.

- [x] Create the feature branch from the checkpoint.

Run: `git checkout track-a-a2-local`
Expected: detached HEAD at A2 checkpoint.

- [x] Create the branch.

Run: `git checkout -b feature/track-a-a3-high-value-extraction`
Expected: new branch created.

### Task 1: Freeze Durable Storage Schema And Migration Contract

**Files:**
- Modify: `packages/core/tests/storage/migrations.test.ts`
- Create: `packages/core/tests/memory/durable.test.ts`

- [x] Add failing tests that define:
  - `durable_memories` table exists after migrations
  - required indexes exist for `topic_key`, `state`, and `source_event_id`
  - optional FTS table exists when FTS5 is available
  - legacy tables remain intact

- [x] Run the storage-focused tests.

Run: `npm test -- packages/core/tests/storage/migrations.test.ts packages/core/tests/memory/durable.test.ts`
Expected: FAIL because the new table and storage class do not exist yet.

- [x] Commit the failing schema tests.

Run: `git add packages/core/tests/storage/migrations.test.ts packages/core/tests/memory/durable.test.ts`
Expected: test-only files staged.

- [x] Commit.

Run: `git commit -m "test(core): define durable memory schema contract"`
Expected: test-only commit created.

### Task 2: Implement Durable Memory Store And Migration

**Files:**
- Create: `packages/core/src/memory/durable.ts`
- Modify: `packages/core/src/storage/migrations.ts`
- Modify: `packages/core/src/types.ts`

- [x] Add the durable-memory table, indexes, and optional FTS support in migrations.

- [x] Implement a focused `DurableMemoryStore` for insert, update state, search, list by topic, and remove-by-id behavior.

- [x] Add typed interfaces in `types.ts` without breaking existing semantic memory types.

- [x] Re-run durable storage tests.

Run: `npm test -- packages/core/tests/storage/migrations.test.ts packages/core/tests/memory/durable.test.ts`
Expected: PASS.

- [x] Commit the storage layer.

Run: `git add packages/core/src/memory/durable.ts packages/core/src/storage/migrations.ts packages/core/src/types.ts`
Expected: durable storage implementation staged.

- [x] Commit.

Run: `git commit -m "feat(core): add durable memory storage"`
Expected: implementation commit created.

### Task 3: Freeze Topic Key And Extraction Rules In Unit Tests

**Files:**
- Create: `packages/core/tests/memory/topic-keys.test.ts`
- Create: `packages/core/tests/memory/durable-extractor.test.ts`
- Create: `packages/core/tests/memory/durable-merge.test.ts`

- [x] Add failing tests for:
  - `database_choice` extraction
  - `auth_strategy` extraction
  - coding-style preference extraction
  - constraint extraction
  - duplicate confirmation updates an existing durable entry instead of creating a new one
  - conflicting newer decision supersedes the older active entry within the same Topic Key

- [x] Run the new unit tests.

Run: `npm test -- packages/core/tests/memory/topic-keys.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts`
Expected: FAIL because the extractor modules do not exist yet.

- [x] Commit the failing extraction contract tests.

Run: `git add packages/core/tests/memory/topic-keys.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts`
Expected: test-only change set staged.

- [x] Commit.

Run: `git commit -m "test(core): define durable extraction and topic key rules"`
Expected: test-only commit created.

### Task 4: Implement Topic Key Generation And Durable Extraction

**Files:**
- Create: `packages/core/src/memory/topic-keys.ts`
- Create: `packages/core/src/memory/durable-extractor.ts`
- Create: `packages/core/src/memory/durable-merge.ts`

- [x] Implement deterministic Topic Key classification and canonicalization helpers.

- [x] Implement a rule-based extractor that reads redacted conversation payloads and emits durable facts only for:
  - decisions
  - preferences
  - style guidance
  - stable constraints

- [x] Implement merge logic that decides between:
  - ignore
  - confirm existing
  - insert new active
  - supersede previous active

- [x] Re-run the extraction unit tests.

Run: `npm test -- packages/core/tests/memory/topic-keys.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts`
Expected: PASS.

- [x] Commit the extraction layer.

Run: `git add packages/core/src/memory/topic-keys.ts packages/core/src/memory/durable-extractor.ts packages/core/src/memory/durable-merge.ts`
Expected: extraction modules staged.

- [x] Commit.

Run: `git commit -m "feat(core): add rule-based durable extraction"`
Expected: implementation commit created.

### Task 5: Add A Durable Extraction Runner After Ingest

**Files:**
- Create: `packages/core/src/memory/durable-runner.ts`
- Modify: `packages/core/src/tools/import-codex.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/tests/tools/import-codex.test.ts`
- Create: `packages/core/tests/integration/durable-extraction-flow.test.ts`
- Modify: `packages/core/tests/integration/codex-import-tool.test.ts`

- [ ] Add a runner that scans newly ingested conversation events using a persisted watermark or last processed event id.

- [ ] Call the runner after successful `processInbox()` in:
  - manual Codex import
  - startup inbox processing
  - pre-search auto-import path

- [ ] Ensure repeated runs are idempotent.

- [ ] Run the integration-focused tests.

Run: `npm test -- packages/core/tests/tools/import-codex.test.ts packages/core/tests/integration/durable-extraction-flow.test.ts packages/core/tests/integration/codex-import-tool.test.ts`
Expected: PASS.

- [ ] Commit the durable runner wiring.

Run: `git add packages/core/src/memory/durable-runner.ts packages/core/src/tools/import-codex.ts packages/core/src/server.ts packages/core/tests/tools/import-codex.test.ts packages/core/tests/integration/durable-extraction-flow.test.ts packages/core/tests/integration/codex-import-tool.test.ts`
Expected: runner wiring changes staged.

- [ ] Commit.

Run: `git commit -m "feat(core): run durable extraction after codex ingest"`
Expected: implementation commit created.

### Task 6: Surface Durable Memories In Search And Decisions Resource

**Files:**
- Modify: `packages/core/src/tools/search.ts`
- Modify: `packages/core/src/resources/decisions.ts`
- Modify: `packages/core/tests/tools/search.test.ts`
- Modify: `packages/core/tests/resources/decisions.test.ts`
- Modify: `packages/core/src/types.ts`

- [ ] Extend search results with a `durable` layer and ensure durable hits are ranked above generic semantic entries when both match.

- [ ] Update the `memory://decisions` resource so it reads from durable memory first and only falls back to legacy semantic memories if durable memory is empty.

- [ ] Re-run search and resource tests.

Run: `npm test -- packages/core/tests/tools/search.test.ts packages/core/tests/resources/decisions.test.ts`
Expected: PASS.

- [ ] Commit the search/resource integration.

Run: `git add packages/core/src/tools/search.ts packages/core/src/resources/decisions.ts packages/core/tests/tools/search.test.ts packages/core/tests/resources/decisions.test.ts packages/core/src/types.ts`
Expected: search and resource changes staged.

- [ ] Commit.

Run: `git commit -m "feat(core): surface durable memory in search and decisions"`
Expected: implementation commit created.

### Task 7: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-track-a-a3-high-value-extraction.md`

- [ ] Run the A3 validation suite.

Run: `npm test -- packages/core/tests/storage/migrations.test.ts packages/core/tests/memory/durable.test.ts packages/core/tests/memory/topic-keys.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/tools/import-codex.test.ts packages/core/tests/tools/search.test.ts packages/core/tests/resources/decisions.test.ts packages/core/tests/integration/durable-extraction-flow.test.ts packages/core/tests/integration/codex-import-tool.test.ts`
Expected: PASS.

- [ ] Run workspace typecheck.

Run: `npm run typecheck`
Expected: PASS.

- [ ] Commit the validation checkpoint.

Run: `git add docs/superpowers/plans/2026-04-21-track-a-a3-high-value-extraction.md`
Expected: plan doc staged if updated.

- [ ] Commit.

Run: `git commit -m "chore(codex): complete track a a3 validation"`
Expected: final A3 validation commit created.

- [ ] Tag the checkpoint.

Run: `git tag -a track-a-a3-local -m "Track A A3 high-value extraction local checkpoint"`
Expected: tag created locally.

## Exit Criteria

- Durable memory exists as a first-class, structured store.
- Topic Keys are generated deterministically where applicable.
- Conflicting newer decisions supersede older ones within the same topic family.
- Search and `memory://decisions` start reflecting extracted durable memory rather than manual semantic memory alone.
