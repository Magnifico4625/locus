# Track D Codex Memory Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Locus reliable enough for Codex Desktop and CLI agents to use as their default project-memory source by adding strict project isolation, temporal/date-bucket recall, freshness/surface truth, stronger ranking, project-state summaries, and acceptance coverage.

**Architecture:** Keep the existing Track C recall engine shape and extend it instead of replacing it. Add project/date metadata at the storage boundary, feed that metadata into candidate loading and scoring, expose calendar and project-state tools, and make status/doctor tell one consistent freshness story for Codex Desktop and CLI. Canonical project identity is the resolved Locus `projectRoot` (git root when available) plus the existing shared-runtime `projectHash`; raw Codex `cwd` values are normalized before they are compared or stored.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, existing `DatabaseAdapter`, SQLite migrations, existing MCP server registration, existing Codex JSONL importer, no new runtime dependency.

---

## Source Context

- Roadmap anchor: `docs/roadmap/codex-next.md`, Track D.
- Roadmap commit: `3a4db1c docs(roadmap): prioritize codex memory reliability`.
- Existing recall modules: `packages/core/src/recall/*`.
- Existing Codex import modules: `packages/codex/src/*`.
- Existing MCP tool registration: `packages/core/src/server.ts`.
- Existing Track C plan style: `docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md`.

## Scope

In scope:

- Project-scoped recall by default for current `projectRoot`.
- Canonical project scope based on the resolved server root: git root when `resolveProjectRoot` finds one, marker root when it does not, and cwd fallback only as a last resort.
- Codex JSONL `cwd` values that point at a subdirectory inside the current resolved project are stored under the canonical current project root so monorepos do not fragment memory by package folder.
- Event-date based temporal recall for day/week/month questions.
- A calendar-style memory discovery tool.
- `memory_recall` result metadata showing resolved range and searched date buckets.
- Candidate ranking that heavily prefers current project, requested time range, exact entities, file paths, active durable memories, and recent context.
- Unified Codex freshness/surface status for Desktop and CLI.
- Project-state summary and verification tool.
- Acceptance tests proving unrelated project memory is not returned.
- Docs and skill sync for the new workflow.
- Project hash visibility in project-state/status output where it helps agents verify they are looking at the same project identity.

Out of scope:

- Cloud embeddings or external semantic search providers.
- Unlimited transcript storage.
- Hidden deletion or automatic destructive cleanup.
- Rewriting Claude Code hooks.
- HTML dashboard implementation.
- Secondary IDE passive capture adapters.
- User-configurable topic namespace filters. Track D keeps topic keys project-scoped by `projectRoot`; a separate topic-namespace filter dimension is a follow-up unless tests prove it is required for isolation.

## File Structure

Create:

- `packages/core/src/recall/project-scope.ts` - project-root normalization, scoped SQL helpers, and legacy/global inclusion policy.
- `packages/core/src/recall/calendar.ts` - date bucket helpers and calendar summary builder.
- `packages/core/src/tools/calendar.ts` - `memory_calendar` handler.
- `packages/core/src/tools/project-state.ts` - `memory_project_state` handler.
- `packages/core/tests/recall/project-scope.test.ts`
- `packages/core/tests/recall/calendar.test.ts`
- `packages/core/tests/tools/calendar.test.ts`
- `packages/core/tests/tools/project-state.test.ts`
- `packages/core/tests/tools/search-project-scope.test.ts`
- `packages/core/tests/tools/timeline-project-scope.test.ts`
- `packages/core/tests/integration/track-d-memory-reliability.test.ts`
- `packages/codex/tests/fixtures/track-d/current-project-may.jsonl`
- `packages/codex/tests/fixtures/track-d/other-project-may.jsonl`
- `packages/codex/tests/fixtures/track-d/desktop-marker.jsonl`

Modify:

- `packages/core/src/types.ts`
- `packages/core/src/storage/migrations.ts`
- `packages/core/src/ingest/pipeline.ts`
- `packages/core/src/memory/semantic.ts`
- `packages/core/src/tools/remember.ts`
- `packages/core/src/tools/import-codex.ts`
- `packages/core/src/memory/durable.ts`
- `packages/core/src/memory/durable-runner.ts`
- `packages/core/src/memory/durable-merge.ts`
- `packages/core/src/memory/topic-key-registry.ts`
- `packages/core/src/recall/index.ts`
- `packages/core/src/recall/engine.ts`
- `packages/core/src/recall/temporal-parser.ts`
- `packages/core/src/recall/query-parser.ts`
- `packages/core/src/recall/candidate-loader.ts`
- `packages/core/src/recall/scoring.ts`
- `packages/core/src/recall/result-builder.ts`
- `packages/core/src/tools/recall.ts`
- `packages/core/src/tools/search.ts`
- `packages/core/src/tools/timeline.ts`
- `packages/core/src/tools/codex-diagnostics.ts`
- `packages/core/src/tools/status.ts`
- `packages/core/src/tools/doctor.ts`
- `packages/core/src/server.ts`
- `packages/codex/src/importer.ts`
- `packages/shared-runtime/detect-client.js`
- `packages/shared-runtime/detect-client.d.ts`
- `package.json`
- `package-lock.json`
- `packages/core/package.json`
- `packages/codex/package.json`
- `packages/cli/package.json`
- `packages/shared-runtime/package.json`
- `packages/core/tests/shared-runtime/detect-client.test.ts`
- `packages/core/tests/tools/recall.test.ts`
- `packages/core/tests/tools/status.test.ts`
- `packages/core/tests/tools/doctor.test.ts`
- `packages/core/tests/tools/codex-diagnostics.test.ts`
- `packages/core/tests/tools/import-codex.test.ts`
- `packages/core/tests/tools/remember.test.ts`
- `packages/core/tests/storage/migrations.test.ts`
- `packages/core/tests/ingest/pipeline-store.test.ts`
- `packages/core/tests/tools/search.test.ts`
- `packages/core/tests/tools/timeline.test.ts`
- `packages/core/tests/memory/semantic.test.ts`
- `packages/core/tests/memory/durable.test.ts`
- `packages/core/tests/memory/durable-merge.test.ts`
- `packages/core/tests/memory/durable-runner.test.ts`
- `packages/core/tests/memory/topic-key-registry.test.ts`
- `packages/core/tests/recall/temporal-parser.test.ts`
- `packages/core/tests/recall/query-parser.test.ts`
- `packages/core/tests/recall/scoring.test.ts`
- `packages/core/tests/integration/server.test.ts`
- `packages/core/tests/integration/durable-extraction-flow.test.ts`
- `packages/core/tests/integration/track-c-recall-acceptance.test.ts` only for compatibility assertions if Track D fields affect the result shape.
- `packages/codex/tests/importer.test.ts`
- `packages/codex/README.md`
- `packages/codex/skills/locus-memory/SKILL.md`
- `README.md`
- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`

Do not modify:

- `packages/claude-code/**` unless a shared-runtime contract test proves a required compatibility update.
- `dist/**` until a release/build checkpoint requires generated artifacts.

---

## Task D0: Baseline And Plan Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-30-track-d-codex-memory-reliability.md`

- [x] **Step D0.1: Verify roadmap commit and clean staged state**

Run:

```bash
git log --oneline -3
git status --short
```

Expected:

- Completed 2026-06-03 on branch `codex/track-d-memory-reliability`.
- `3a4db1c docs(roadmap): prioritize codex memory reliability` is an ancestor of current HEAD. It appears in `git log --oneline -5`; `git log --oneline -3` now shows later Track D plan commits on top.
- Working tree was clean.

- [x] **Step D0.2: Run current focused baseline tests**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/integration/track-c-recall-acceptance.test.ts
```

Expected: PASS before Track D changes.

Completed 2026-06-03:

- `9` test files passed.
- `124` tests passed.
- Node emitted experimental `node:sqlite` warnings only; no test failures.

- [x] **Step D0.3: Commit the approved plan**

Run:

```bash
git add docs/superpowers/plans/2026-05-30-track-d-codex-memory-reliability.md
git commit -m "docs(codex): plan track d memory reliability"
```

Expected: docs-only plan checkpoint.

Completed before implementation on this branch via the existing docs-only plan commits:

- `78bbbce docs(codex): plan track d memory reliability`
- `dfdc56f docs(codex): refine track d implementation plan`
- `cb19333 docs(codex): harden track d memory plan`

No empty D0-only commit was created.

---

## Task D1: Project Scope Contract And Storage Metadata

**Files:**
- Create: `packages/core/src/recall/project-scope.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/storage/migrations.ts`
- Modify: `packages/core/src/ingest/pipeline.ts`
- Modify: `packages/codex/src/importer.ts`
- Modify: `packages/core/src/memory/semantic.ts`
- Modify: `packages/core/src/tools/remember.ts`
- Modify: `packages/core/src/tools/import-codex.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/src/memory/durable.ts`
- Modify: `packages/core/src/memory/durable-runner.ts`
- Test: `packages/core/tests/recall/project-scope.test.ts`
- Test: `packages/core/tests/storage/migrations.test.ts`
- Test: `packages/core/tests/ingest/pipeline-store.test.ts`
- Test: `packages/codex/tests/importer.test.ts`
- Test: `packages/core/tests/memory/semantic.test.ts`
- Test: `packages/core/tests/memory/durable.test.ts`
- Test: `packages/core/tests/tools/remember.test.ts`
- Test: `packages/core/tests/tools/import-codex.test.ts`
- Test: `packages/core/tests/integration/server.test.ts`
- Test: `packages/core/tests/integration/durable-extraction-flow.test.ts`

- [x] **Step D1.1: Write failing project scope helper tests**

Create `packages/core/tests/recall/project-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildProjectScopeClause,
  isSameProjectRoot,
  normalizeProjectRootForScope,
} from '../../src/recall/project-scope.js';

describe('project scope helpers', () => {
  it('normalizes Windows and POSIX paths for stable scope identity', () => {
    expect(normalizeProjectRootForScope('C:\\Users\\Admin\\Project')).toBe(
      'c:/users/admin/project',
    );
    expect(normalizeProjectRootForScope('C:/Users/Admin//Project/')).toBe(
      'c:/users/admin/project',
    );
  });

  it('matches equivalent project roots', () => {
    expect(isSameProjectRoot('C:\\Users\\Admin\\Project', 'c:/users/admin/project')).toBe(true);
    expect(isSameProjectRoot('/repo/locus', '/repo/other')).toBe(false);
  });

  it('builds strict SQL scope by default', () => {
    expect(buildProjectScopeClause('project_root', 'C:/repo/locus')).toEqual({
      clause: 'project_root = ?',
      params: ['c:/repo/locus'],
    });
  });

  it('can include legacy global rows only when explicitly allowed', () => {
    expect(
      buildProjectScopeClause('project_root', 'C:/repo/locus', { includeLegacyGlobal: true }),
    ).toEqual({
      clause: '(project_root = ? OR project_root IS NULL)',
      params: ['c:/repo/locus'],
    });
  });
});
```

Run:

```bash
npm test -- packages/core/tests/recall/project-scope.test.ts
```

Expected: FAIL because `project-scope.ts` does not exist.

- [x] **Step D1.2: Implement project scope helper**

Create `packages/core/src/recall/project-scope.ts`:

```ts
import { normalizePathForIdentity } from '@locus/shared-runtime';

export interface ProjectScopeClauseOptions {
  includeLegacyGlobal?: boolean;
}

export interface ProjectScopeClause {
  clause: string;
  params: string[];
}

export function normalizeProjectRootForScope(projectRoot: string): string {
  const normalized = normalizePathForIdentity(projectRoot.trim());
  if (normalized === '/' || /^[a-z]:\/$/u.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/$/u, '');
}

export function isSameProjectRoot(left: string | null | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  return normalizeProjectRootForScope(left) === normalizeProjectRootForScope(right);
}

export function buildProjectScopeClause(
  column: string,
  projectRoot: string,
  options?: ProjectScopeClauseOptions,
): ProjectScopeClause {
  const normalized = normalizeProjectRootForScope(projectRoot);
  if (options?.includeLegacyGlobal) {
    return {
      clause: `(${column} = ? OR ${column} IS NULL)`,
      params: [normalized],
    };
  }
  return {
    clause: `${column} = ?`,
    params: [normalized],
  };
}
```

Run:

```bash
npm test -- packages/core/tests/recall/project-scope.test.ts
```

Expected: PASS.

- [x] **Step D1.3: Write failing migration tests for project metadata**

Extend `packages/core/tests/storage/migrations.test.ts`:

```ts
const memoryColumns = adapter.all<{ name: string }>('PRAGMA table_info(memories)');
expect(memoryColumns.map((row) => row.name)).toContain('project_root');

const durableColumns = adapter.all<{ name: string }>('PRAGMA table_info(durable_memories)');
expect(durableColumns.map((row) => row.name)).toContain('project_root');

const conversationColumns = adapter.all<{ name: string }>(
  'PRAGMA table_info(conversation_events)',
);
expect(conversationColumns.map((row) => row.name)).toContain('project_root');

const indexes = adapter.all<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type = 'index'",
);
expect(indexes.map((row) => row.name)).toEqual(
  expect.arrayContaining([
    'idx_memories_project_updated',
    'idx_dm_project_state_topic_updated',
    'idx_ce_project_timestamp',
    'idx_ce_project_session_timestamp',
  ]),
);
```

Run:

```bash
npm test -- packages/core/tests/storage/migrations.test.ts
```

Expected: FAIL because the new columns/indexes do not exist.

- [x] **Step D1.4: Add migration v4 for project metadata and indexes**

Current schema facts before this migration:

- `conversation_events.project_root` already exists in migration V2 and must not be added again.
- `memories.project_root` does not exist in migration V1 and must be added defensively.
- `durable_memories.project_root` does not exist in migration V3 and must be added defensively.
- `columnExists` guards are required so fresh databases, upgraded databases, and partially migrated local databases all survive V4.

Modify `packages/core/src/storage/migrations.ts`:

```ts
import { normalizeProjectRootForScope } from '../recall/project-scope.js';

function columnExists(db: DatabaseAdapter, table: string, column: string): boolean {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function normalizeStoredProjectRoots(db: DatabaseAdapter, table: string): void {
  const rows = db.all<{ id: number; project_root: string | null }>(
    `SELECT id, project_root FROM ${table} WHERE project_root IS NOT NULL`,
  );
  for (const row of rows) {
    if (!row.project_root) continue;
    const normalized = normalizeProjectRootForScope(row.project_root);
    if (normalized !== row.project_root) {
      db.run(`UPDATE ${table} SET project_root = ? WHERE id = ?`, [normalized, row.id]);
    }
  }
}

function migrationV4(db: DatabaseAdapter): void {
  if (!columnExists(db, 'memories', 'project_root')) {
    db.exec('ALTER TABLE memories ADD COLUMN project_root TEXT');
  }

  if (!columnExists(db, 'durable_memories', 'project_root')) {
    db.exec('ALTER TABLE durable_memories ADD COLUMN project_root TEXT');
  }

  if (!columnExists(db, 'conversation_events', 'project_root')) {
    throw new Error('conversation_events.project_root is required before migration v4');
  }

  normalizeStoredProjectRoots(db, 'conversation_events');
  normalizeStoredProjectRoots(db, 'memories');
  normalizeStoredProjectRoots(db, 'durable_memories');

  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project_root, updated_at)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_dm_project_state_topic_updated ON durable_memories(project_root, state, topic_key, updated_at)',
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_project_timestamp ON conversation_events(project_root, timestamp)');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ce_project_session_timestamp ON conversation_events(project_root, session_id, timestamp)',
  );

  db.run('UPDATE schema_version SET version = ?', [4]);
}
```

Performance note: this row-by-row normalization is acceptable for the expected local SQLite/SQL.js database size, but wrap the V4 body in the repository's existing migration transaction pattern if one exists. If an implementation benchmark shows large `conversation_events` tables are slow, switch `normalizeStoredProjectRoots` to batched updates before merging D1.

In `runMigrations`, add:

```ts
if (currentVersion < 4) {
  migrationV4(db);
}
```

Run:

```bash
npm test -- packages/core/tests/storage/migrations.test.ts
```

Expected: PASS.

- [x] **Step D1.4a: Normalize project root at ingestion**

Modify `packages/core/src/ingest/pipeline.ts` so stored `conversation_events.project_root` always uses the canonical project identity when the server knows it, and otherwise falls back to `normalizeProjectRootForScope(event.project_root)`.

Extend options:

```ts
export interface ProcessInboxOptions {
  batchLimit?: number;
  captureLevel?: CaptureLevel;
  fts5Available?: boolean;
  projectRoot?: string;
}
```

Add a helper that treats subdirectories under the resolved root as the same project. This prevents Codex sessions started from `packages/core` from being stored under a different scope than a server whose resolved root is the repo git root:

```ts
function canonicalStoredProjectRoot(eventProjectRoot: string, currentProjectRoot?: string): string {
  const eventRoot = normalizeProjectRootForScope(eventProjectRoot);
  if (!currentProjectRoot) {
    return eventRoot;
  }

  const currentRoot = normalizeProjectRootForScope(currentProjectRoot);
  if (eventRoot === currentRoot || eventRoot.startsWith(`${currentRoot}/`)) {
    return currentRoot;
  }
  return eventRoot;
}
```

Use it before the insert:

```ts
const projectRoot = canonicalStoredProjectRoot(event.project_root, options?.projectRoot);
```

Use `projectRoot` in the conversation insert instead of `event.project_root`.

Update `packages/core/src/server.ts` so every `processInbox` call passes the resolved server root:

```ts
processInbox(inboxDir, db, {
  batchLimit: 50,
  captureLevel: config.captureLevel,
  fts5Available: fts5,
  projectRoot: root,
});
```

Add/extend `packages/core/tests/ingest/pipeline-store.test.ts`:

```ts
it('normalizes project_root before storing conversation events', async () => {
  const event = makeValidEvent({
    event_id: 'evt-project-normalized',
    project_root: 'C:\\Users\\Admin\\Project',
  });
  writeInboxEvent(inboxDir, event);
  processInbox(inboxDir, adapter, { captureLevel: 'redacted', fts5Available: true });

  const row = adapter.get<{ project_root: string }>(
    'SELECT project_root FROM conversation_events WHERE event_id = ?',
    ['evt-project-normalized'],
  );
  expect(row?.project_root).toBe('c:/users/admin/project');
});

it('stores a subdirectory Codex cwd under the current project root', async () => {
  const event = makeValidEvent({
    event_id: 'evt-project-subdir',
    project_root: 'C:\\Users\\Admin\\Project\\packages\\core',
  });
  writeInboxEvent(inboxDir, event);
  processInbox(inboxDir, adapter, {
    captureLevel: 'redacted',
    fts5Available: true,
    projectRoot: 'C:\\Users\\Admin\\Project',
  });

  const row = adapter.get<{ project_root: string }>(
    'SELECT project_root FROM conversation_events WHERE event_id = ?',
    ['evt-project-subdir'],
  );
  expect(row?.project_root).toBe('c:/users/admin/project');
});
```

Run:

```bash
npm test -- packages/core/tests/ingest/pipeline-store.test.ts
```

Expected: PASS.

- [x] **Step D1.4b: Normalize Codex importer project filters**

Codex 0.135 resume and app-server flows can preserve or override `cwd` across resumed threads. The importer must compare equivalent project roots by identity, not raw string form, before it decides to drop events. It must also accept events whose raw Codex `cwd` is a subdirectory of the current resolved project root, then canonicalize those imported events to the current root.

Modify `packages/codex/src/importer.ts`:

```ts
import { normalizePathForIdentity } from '@locus/shared-runtime';

function normalizedProjectRoot(value: string): string {
  return normalizePathForIdentity(value);
}

function sameOrInsideProjectRoot(eventRootValue: string, requestedRootValue: string): boolean {
  const eventRoot = normalizedProjectRoot(eventRootValue);
  const requestedRoot = normalizedProjectRoot(requestedRootValue);
  return eventRoot === requestedRoot || eventRoot.startsWith(`${requestedRoot}/`);
}

function canonicalImportProjectRoot(eventRoot: string, requestedRoot?: string): string {
  if (requestedRoot && sameOrInsideProjectRoot(eventRoot, requestedRoot)) {
    return normalizedProjectRoot(requestedRoot);
  }
  return normalizedProjectRoot(eventRoot);
}

function matchesFilters(event: CodexNormalizedEvent, options: CodexImportOptions): boolean {
  if (
    options.projectRoot !== undefined &&
    !sameOrInsideProjectRoot(event.projectRoot, options.projectRoot)
  ) {
    return false;
  }

  if (options.sessionId !== undefined && event.sessionId !== options.sessionId) {
    return false;
  }

  if (options.since !== undefined && event.timestamp < options.since) {
    return false;
  }

  return true;
}

const filteredEvents = normalized.events
  .filter((event) => matchesFilters(event, options))
  .map((event) => ({
    ...event,
    projectRoot: canonicalImportProjectRoot(event.projectRoot, options.projectRoot),
  }));
```

Extend `packages/codex/tests/importer.test.ts`:

```ts
it('filters projectRoot with normalized path identity', () => {
  const sessionsDir = join(root, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeRollout(sessionsDir, 'rollout-normalized-project.jsonl', [
    '{"type":"session_meta","timestamp":"2026-05-30T10:00:00.000Z","session_id":"sess-normalized","cwd":"C:\\\\Projects\\\\SampleApp","model":"gpt-5.4"}',
    '{"type":"event_msg","timestamp":"2026-05-30T10:01:00.000Z","subtype":"user_message","message":"TRACKD-NORMALIZED-PROJECT"}',
  ]);

  const metrics = importCodexSessionsToInbox({
    sessionsDir,
    inboxDir,
    captureMode: 'redacted',
    projectRoot: 'c:/projects/sampleapp',
  });

  expect(metrics.written).toBeGreaterThan(0);
});

it('accepts a Codex cwd inside the requested project root and stores the canonical root', () => {
  const sessionsDir = join(root, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeRollout(sessionsDir, 'rollout-subdir-project.jsonl', [
    '{"type":"session_meta","timestamp":"2026-05-30T10:00:00.000Z","session_id":"sess-subdir","cwd":"C:\\\\Projects\\\\SampleApp\\\\packages\\\\core","model":"gpt-5.4"}',
    '{"type":"event_msg","timestamp":"2026-05-30T10:01:00.000Z","subtype":"user_message","message":"TRACKD-SUBDIR-PROJECT"}',
  ]);

  const metrics = importCodexSessionsToInbox({
    sessionsDir,
    inboxDir,
    captureMode: 'redacted',
    projectRoot: 'c:/projects/sampleapp',
  });

  expect(metrics.written).toBeGreaterThan(0);
  // Read the written inbox event and assert project_root is c:/projects/sampleapp.
});
```

Run:

```bash
npm test -- packages/codex/tests/importer.test.ts
```

Expected: PASS.

- [x] **Step D1.5: Extend semantic memory to store project root**

Modify `packages/core/src/types.ts`:

```ts
export interface MemoryEntry {
  id: number;
  layer: 'semantic' | 'episodic';
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  projectRoot?: string;
}
```

Modify `packages/core/src/memory/semantic.ts`:

```ts
export interface SemanticMemoryAddOptions {
  projectRoot?: string;
}
```

Change `add` signature:

```ts
add(content: string, tags: string[], options?: SemanticMemoryAddOptions): MemoryEntry
```

Insert with project root:

```ts
const projectRoot = options?.projectRoot
  ? normalizeProjectRootForScope(options.projectRoot)
  : null;
const result = this.db.run(
  'INSERT INTO memories (layer, content, tags_json, created_at, updated_at, project_root) VALUES (?, ?, ?, ?, ?, ?)',
  ['semantic', content, tagsJson, now, now, projectRoot],
);
```

Update `rowToEntry` to map `project_root`.

Run:

```bash
npm test -- packages/core/tests/memory/semantic.test.ts packages/core/tests/tools/remember.test.ts
```

Expected: tests pass after updates.

- [x] **Step D1.6: Pass project root through memory_remember**

Modify `packages/core/src/tools/remember.ts`:

```ts
export interface RememberDeps {
  semantic: SemanticMemory;
  projectRoot?: string;
}

export function handleRemember(text: string, tags: string[], deps: RememberDeps): MemoryEntry {
  const redacted = redact(text);
  return deps.semantic.add(redacted, tags, { projectRoot: deps.projectRoot });
}
```

Modify `packages/core/src/server.ts` registration:

```ts
const entry = handleRemember(text, tags ?? [], { semantic, projectRoot: root });
```

Run:

```bash
npm test -- packages/core/tests/tools/remember.test.ts packages/core/tests/integration/server.test.ts
```

Expected: PASS.

- [x] **Step D1.7: Extend durable memory project root contract**

Modify `packages/core/src/types.ts`:

```ts
export interface DurableMemoryEntry {
  id: number;
  projectRoot?: string;
  topicKey?: string;
  memoryType: DurableMemoryType;
  state: DurableMemoryState;
  summary: string;
  evidence: Record<string, unknown>;
  sourceEventId?: string;
  source: 'codex' | 'claude-code' | 'manual';
  supersededById?: number;
  createdAt: number;
  updatedAt: number;
}
```

Modify `CreateDurableMemoryInput` in `packages/core/src/memory/durable.ts`:

```ts
projectRoot?: string;
```

Include normalized `project_root` in insert and row mapping:

```ts
const projectRoot = input.projectRoot ? normalizeProjectRootForScope(input.projectRoot) : null;
```

Run:

```bash
npm test -- packages/core/tests/memory/durable.test.ts packages/core/tests/memory/durable-merge.test.ts
```

Expected: PASS after expected fixture updates.

- [x] **Step D1.8: Attach durable memory project root from source events**

Modify `packages/core/src/memory/durable-runner.ts` so rows selected from `conversation_events` include `project_root` and pass it into `store.insert`.

Also scope durable merge lookups to the source event project. Do not let a same-topic memory from another project confirm or supersede a current-project candidate.

Modify `DurableMemoryStore` to support project-scoped list helpers:

```ts
listByTopic(topicKey: string, options?: { projectRoot?: string }): DurableMemoryEntry[]
listByMemoryType(memoryType: DurableMemoryType, options?: { projectRoot?: string }): DurableMemoryEntry[]
```

When `options.projectRoot` is present, add `AND project_root = ?` to those queries.

Update runner lookup:

```ts
const existingEntries = candidate.topicKey
  ? store.listByTopic(candidate.topicKey, { projectRoot: event.project_root ?? undefined })
  : store.listByMemoryType(candidate.memoryType, { projectRoot: event.project_root ?? undefined });
```

Expected insertion shape:

```ts
store.insert({
  topicKey: candidate.topicKey,
  memoryType: candidate.memoryType,
  summary: candidate.summary,
  evidence: candidate.evidence,
  sourceEventId: event.event_id,
  projectRoot: event.project_root,
  source: candidate.source,
});
```

Run:

```bash
npm test -- packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/integration/track-c-recall-acceptance.test.ts
```

Expected: PASS.

- [x] **Step D1.9: Commit project scope metadata**

Run:

```bash
git add packages/core/src/recall/project-scope.ts packages/core/src/types.ts packages/core/src/storage/migrations.ts packages/core/src/ingest/pipeline.ts packages/codex/src/importer.ts packages/core/src/memory/semantic.ts packages/core/src/tools/remember.ts packages/core/src/tools/import-codex.ts packages/core/src/server.ts packages/core/src/memory/durable.ts packages/core/src/memory/durable-runner.ts packages/core/tests/recall/project-scope.test.ts packages/core/tests/storage/migrations.test.ts packages/core/tests/ingest/pipeline-store.test.ts packages/codex/tests/importer.test.ts packages/core/tests/memory/semantic.test.ts packages/core/tests/memory/durable.test.ts packages/core/tests/tools/remember.test.ts packages/core/tests/tools/import-codex.test.ts packages/core/tests/integration/server.test.ts packages/core/tests/integration/durable-extraction-flow.test.ts
git commit -m "feat(core): add project-scoped memory metadata"
```

Completion evidence (2026-06-03):

```bash
npm test -- packages/core/tests/recall/project-scope.test.ts packages/core/tests/storage/migrations.test.ts packages/core/tests/ingest/pipeline-store.test.ts packages/codex/tests/importer.test.ts packages/core/tests/memory/semantic.test.ts packages/core/tests/memory/durable.test.ts packages/core/tests/tools/remember.test.ts packages/core/tests/tools/import-codex.test.ts packages/core/tests/integration/server.test.ts packages/core/tests/integration/durable-extraction-flow.test.ts packages/core/tests/memory/durable-extractor.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/integration/track-c-recall-acceptance.test.ts
# PASS: 13 files, 184 tests

npm -w @locus/core run typecheck
# PASS

npm -w @locus/codex run typecheck
# PASS
```

---

## Task D2: Temporal Parser And Date Buckets

**Files:**
- Create: `packages/core/src/recall/calendar.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/recall/temporal-parser.ts`
- Modify: `packages/core/src/recall/query-parser.ts`
- Modify: `packages/core/src/recall/index.ts`
- Modify: `packages/core/src/tools/search.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/recall/temporal-parser.test.ts`
- Test: `packages/core/tests/recall/query-parser.test.ts`
- Test: `packages/core/tests/recall/calendar.test.ts`
- Test: `packages/core/tests/tools/search.test.ts`
- Test: `packages/core/tests/tools/timeline.test.ts`
- Test: `packages/core/tests/tools/recall.test.ts`

- [x] **Step D2.1: Write failing parser tests for month/week phrases**

Extend `packages/core/tests/recall/temporal-parser.test.ts` with:

```ts
const may30 = Date.parse('2026-05-30T12:00:00.000Z');

it.each([
  [
    'вспомни работу в этом месяце',
    'в этом месяце',
    '2026-05-01T00:00:00.000Z',
    '2026-06-01T00:00:00.000Z',
  ],
  [
    'what did we do this month?',
    'this month',
    '2026-05-01T00:00:00.000Z',
    '2026-06-01T00:00:00.000Z',
  ],
  [
    'что делали в мае?',
    'май 2026',
    '2026-05-01T00:00:00.000Z',
    '2026-06-01T00:00:00.000Z',
  ],
  [
    'what happened in April?',
    'april 2026',
    '2026-04-01T00:00:00.000Z',
    '2026-05-01T00:00:00.000Z',
  ],
])('parses period query %s', (question, label, fromIso, toIso) => {
  expect(parseRecallTemporalRange(question, may30)).toEqual({
    label,
    from: Date.parse(fromIso),
    to: Date.parse(toIso),
    fromIso,
    toIso,
  });
});
```

Run:

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts
```

Expected: FAIL for month phrases.

- [x] **Step D2.2: Add date bucket types**

Modify `packages/core/src/types.ts`:

```ts
export interface MemoryDateBucket {
  key: string;
  label: string;
  from: number;
  to: number;
  eventCount: number;
  sessionCount: number;
  durableCount: number;
  topicKeys: string[];
}

export interface MemoryRecallResolvedRange {
  label: string;
  from: number;
  to: number;
  fromIso: string;
  toIso: string;
  granularity?: 'day' | 'week' | 'month' | 'custom';
}
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS or only failures in code that needs the new optional field imported.

- [x] **Step D2.3: Implement calendar helper**

Create `packages/core/src/recall/calendar.ts`:

```ts
export type DateBucketGranularity = 'day' | 'week' | 'month';

export interface DateBucketRange {
  key: string;
  label: string;
  from: number;
  to: number;
}

export function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function weekBucket(timestamp: number): DateBucketRange {
  const dayStart = startOfUtcDay(timestamp);
  const day = new Date(dayStart).getUTCDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const from = dayStart - mondayOffset * 24 * 60 * 60 * 1000;
  const to = from + 7 * 24 * 60 * 60 * 1000;
  const key = `${new Date(from).toISOString().slice(0, 10)}/week`;
  return { key, label: key, from, to };
}

export function monthBucket(timestamp: number): DateBucketRange {
  const date = new Date(timestamp);
  const from = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const to = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const key = new Date(from).toISOString().slice(0, 7);
  return { key, label: key, from, to };
}

export function dayBucket(timestamp: number): DateBucketRange {
  const from = startOfUtcDay(timestamp);
  const to = from + 24 * 60 * 60 * 1000;
  const key = new Date(from).toISOString().slice(0, 10);
  return { key, label: key, from, to };
}
```

Add tests in `packages/core/tests/recall/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayBucket, monthBucket, weekBucket } from '../../src/recall/calendar.js';

describe('calendar buckets', () => {
  it('builds stable UTC day buckets', () => {
    expect(dayBucket(Date.parse('2026-05-30T12:34:00.000Z'))).toMatchObject({
      key: '2026-05-30',
      from: Date.parse('2026-05-30T00:00:00.000Z'),
      to: Date.parse('2026-05-31T00:00:00.000Z'),
    });
  });

  it('builds stable UTC month buckets', () => {
    expect(monthBucket(Date.parse('2026-05-30T12:34:00.000Z'))).toMatchObject({
      key: '2026-05',
      from: Date.parse('2026-05-01T00:00:00.000Z'),
      to: Date.parse('2026-06-01T00:00:00.000Z'),
    });
  });

  it('builds stable Monday-based UTC week buckets', () => {
    expect(weekBucket(Date.parse('2026-05-30T12:34:00.000Z'))).toMatchObject({
      key: '2026-05-25/week',
      from: Date.parse('2026-05-25T00:00:00.000Z'),
      to: Date.parse('2026-06-01T00:00:00.000Z'),
    });
  });
});
```

Run:

```bash
npm test -- packages/core/tests/recall/calendar.test.ts
```

Expected: PASS.

- [x] **Step D2.4: Implement month phrase parsing**

Modify `packages/core/src/recall/temporal-parser.ts`:

- Import `monthBucket`.
- Add EN/RU month name maps.
- Detect `this month`, `в этом месяце`, `in May`, `в мае`.
- Use the current year when no year is in the question.

Expected helper shape:

```ts
const MONTH_NAMES = new Map<string, number>([
  ['january', 0],
  ['february', 1],
  ['march', 2],
  ['april', 3],
  ['may', 4],
  ['june', 5],
  ['july', 6],
  ['august', 7],
  ['september', 8],
  ['october', 9],
  ['november', 10],
  ['december', 11],
  ['январ', 0],
  ['феврал', 1],
  ['март', 2],
  ['апрел', 3],
  ['май', 4],
  ['мае', 4],
  ['мая', 4],
  ['июн', 5],
  ['июл', 6],
  ['август', 7],
  ['сентябр', 8],
  ['октябр', 9],
  ['ноябр', 10],
  ['декабр', 11],
]);
```

Run:

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts packages/core/tests/recall/query-parser.test.ts
```

Expected: PASS.

- [x] **Step D2.5: Extend MCP timeRange enum safely**

Modify `packages/core/src/types.ts`:

```ts
export type TimeRangeRelative =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_7d'
  | 'last_30d'
  | 'this_month'
  | 'last_month';
```

Modify every MCP schema in `packages/core/src/server.ts` that currently lists relative values to include `this_month` and `last_month`.

Modify `resolveTimeRange` in `packages/core/src/tools/search.ts` to support the new values with explicit month boundary helpers:

```ts
function startOfMonth(timestamp: number, mode: TimeResolutionMode): Date {
  const date = new Date(timestamp);
  if (mode === 'utc') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number, mode: TimeResolutionMode): Date {
  const next = new Date(date);
  if (mode === 'utc') {
    next.setUTCMonth(next.getUTCMonth() + months);
  } else {
    next.setMonth(next.getMonth() + months);
  }
  return next;
}
```

Add cases:

```ts
case 'this_month': {
  const start = startOfMonth(now, mode);
  const end = addMonths(start, 1, mode);
  return { from: start.getTime(), to: end.getTime() };
}
case 'last_month': {
  const thisMonth = startOfMonth(now, mode);
  const previousMonth = addMonths(thisMonth, -1, mode);
  return { from: previousMonth.getTime(), to: thisMonth.getTime() };
}
```

Extend `packages/core/tests/tools/search.test.ts`, `packages/core/tests/tools/timeline.test.ts`, and `packages/core/tests/tools/recall.test.ts` with fixed-date assertions for `this_month` and `last_month`.

Run:

```bash
npm test -- packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts packages/core/tests/tools/recall.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step D2.5a: Unify timezone policy for recall, search, timeline, and calendar**

Current code mixes UTC recall parsing with local `resolveTimeRange` defaults. Track D must make this explicit before date-bucket recall ships.

Implementation rule:

- User-facing MCP tools use local-time boundaries by default because users ask "today", "this month", and named months in their local working context.
- Unit tests may pass `mode: 'utc'` or a fixed `now` helper for deterministic assertions.
- Add one explicit non-UTC regression test for month/day boundaries. Prefer a helper that calls the date functions with `mode: 'local'` and a known `TZ=Europe/Moscow` or `TZ=America/New_York` child-process environment; if the current platform cannot honor `TZ`, keep the test deterministic by using `mode: 'utc'` and document why host-local timezone tests are skipped.
- Any test that mutates `process.env.TZ` or other process-wide env must run sequentially, not `test.concurrent`.
- `resolvedRange.fromIso` and `toIso` remain ISO timestamps so agents can report exact absolute boundaries.

Modify `packages/core/src/recall/temporal-parser.ts`:

```ts
export interface RecallTemporalParseOptions {
  mode?: 'local' | 'utc';
}

export function parseRecallTemporalRange(
  question: string,
  now: number,
  options?: RecallTemporalParseOptions,
): ParsedRecallRange | undefined
```

Modify `parseRecallQuery` and `runRecallEngine` to pass the same mode used by MCP recall. Keep existing UTC tests by passing `{ mode: 'utc' }`.

Modify `packages/core/src/recall/query-parser.ts`:

```ts
export interface ParseRecallQueryOptions {
  temporalMode?: 'local' | 'utc';
}

export function parseRecallQuery(
  question: string,
  now: number,
  options?: ParseRecallQueryOptions,
): ParsedRecallQuery {
  const normalized = normalizeQuestion(question);
  const normalizedTerms = normalized.length > 0 ? normalized.split(' ') : [];
  const terms = normalizedTerms.filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
  const termVariants = unique(terms.map(stemLite));
  const temporalRange = parseRecallTemporalRange(question, now, {
    mode: options?.temporalMode ?? 'local',
  });

  return {
    original: question,
    normalized,
    normalizedTerms,
    terms,
    termVariants,
    intent: detectIntent(normalized),
    ...(temporalRange ? { temporalRange } : {}),
    topicHints: detectTopicHints(normalized),
  };
}
```

Modify `packages/core/src/recall/engine.ts`:

```ts
export interface RecallEngineOptions {
  timeRange?: TimeRange;
  limit?: number;
  now?: number;
  temporalMode?: 'local' | 'utc';
}

const temporalMode = options?.temporalMode ?? 'local';
const parsedQuery = parseRecallQuery(question, now, { temporalMode });
```

Pass `temporalMode` into `buildResolvedRange` so explicit MCP `timeRange` and natural-language temporal parsing use the same boundary policy:

```ts
const resolved = resolveTimeRange(timeRange, now, temporalMode);
```

Modify `packages/core/src/recall/calendar.ts` so bucket helpers accept the same mode:

```ts
export interface DateBucketOptions {
  mode?: 'local' | 'utc';
}

export function dayBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange
export function weekBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange
export function monthBucket(timestamp: number, options?: DateBucketOptions): DateBucketRange
```

D2 implements the shared calendar bucket helpers with `{ mode: 'local' }` as the default and explicit `{ mode: 'utc' }` for deterministic tests. `handleCalendar` and `buildBucketsForCandidates` do not exist until Task D3; D3 must call these helpers with the MCP default local mode instead of inventing a second timezone policy.

Update `packages/core/tests/recall/query-parser.test.ts`:

```ts
it('passes UTC temporal mode through query parsing for deterministic tests', () => {
  const parsed = parseRecallQuery('what happened this month?', Date.parse('2026-05-30T12:00:00.000Z'), {
    temporalMode: 'utc',
  });

  expect(parsed.temporalRange).toMatchObject({
    fromIso: '2026-05-01T00:00:00.000Z',
    toIso: '2026-06-01T00:00:00.000Z',
  });
});
```

Run:

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts packages/core/tests/recall/query-parser.test.ts packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts packages/core/tests/tools/recall.test.ts
```

Expected: PASS and no mismatch between recall/search/timeline date boundaries.

- [x] **Step D2.5b: Update recall barrel exports**

Modify `packages/core/src/recall/index.ts` so downstream tests and tools can import the new temporal and calendar contracts without reaching into private files:

```ts
export type { DateBucketOptions, DateBucketRange } from './calendar.js';
export { dayBucket, monthBucket, weekBucket } from './calendar.js';
export type { ParseRecallQueryOptions } from './query-parser.js';
export type { RecallTemporalParseOptions } from './temporal-parser.js';
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS.

- [x] **Step D2.6: Commit temporal bucket support**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/recall/calendar.ts packages/core/src/recall/temporal-parser.ts packages/core/src/recall/query-parser.ts packages/core/src/recall/index.ts packages/core/src/tools/search.ts packages/core/src/tools/recall.ts packages/core/src/server.ts packages/core/tests/recall/calendar.test.ts packages/core/tests/recall/temporal-parser.test.ts packages/core/tests/recall/query-parser.test.ts packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts packages/core/tests/tools/recall.test.ts
git commit -m "feat(core): add temporal recall buckets"
```

Completion evidence (2026-06-04):

```bash
npm test -- packages/core/tests/recall/temporal-parser.test.ts packages/core/tests/recall/query-parser.test.ts packages/core/tests/recall/calendar.test.ts packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts packages/core/tests/tools/recall.test.ts
# PASS: 6 files, 100 tests

npm -w @locus/core run typecheck
# PASS

npm test -- packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/tests/integration/server.test.ts
# PASS: 2 files, 28 tests
```

---

## Task D3: Calendar Discovery Tool

**Files:**
- Create: `packages/core/src/tools/calendar.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/server.ts`
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `packages/codex/skills/locus-memory/SKILL.md`
- Modify: `docs/codex-vscode-extension.md`
- Test: `packages/core/tests/tools/calendar.test.ts`
- Test: `packages/core/tests/integration/server.test.ts`
- Test: `packages/codex/tests/skill-contract.test.ts`
- Test: `packages/codex/tests/skill-sync.test.ts`

- [x] **Step D3.1: Add public result types**

Modify `packages/core/src/types.ts`:

```ts
export interface MemoryCalendarOptions {
  timeRange?: TimeRange;
  granularity?: 'day' | 'week' | 'month';
  projectRoot?: string;
  limit?: number;
}

export interface MemoryCalendarResult {
  projectRoot: string;
  resolvedRange?: MemoryRecallResolvedRange;
  granularity: 'day' | 'week' | 'month';
  buckets: MemoryDateBucket[];
}
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS after imports compile.

- [x] **Step D3.2: Write failing calendar tool tests**

Create `packages/core/tests/tools/calendar.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleCalendar } from '../../src/tools/calendar.js';

describe('handleCalendar', () => {
  let dir: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-calendar-'));
    // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
    const sqlite = require('node:sqlite') as any;
    db = new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns day buckets only for the requested project', () => {
    const may12 = Date.parse('2026-05-12T10:00:00.000Z');
    const may24 = Date.parse('2026-05-24T10:00:00.000Z');
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['locus-1', 'codex', null, 'c:/repo/locus', 'sess-locus', may12, 'session_end', '{"summary":"v3.6.1"}', 'high', null, may12],
    );
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['vpn-1', 'codex', null, 'c:/repo/proxyvpn', 'sess-vpn', may24, 'session_end', '{"summary":"VPN"}', 'high', null, may24],
    );

    const result = handleCalendar(
      { db, projectRoot: 'C:/repo/locus', now: Date.parse('2026-05-30T12:00:00.000Z') },
      { timeRange: { relative: 'this_month' }, granularity: 'day' },
    );

    expect(result.buckets).toEqual([
      expect.objectContaining({
        key: '2026-05-12',
        eventCount: 1,
        sessionCount: 1,
      }),
    ]);
  });
});
```

Run:

```bash
npm test -- packages/core/tests/tools/calendar.test.ts
```

Expected: FAIL because `tools/calendar.ts` does not exist.

- [x] **Step D3.3: Implement `handleCalendar`**

Create `packages/core/src/tools/calendar.ts` with this public shape:

```ts
import type { DatabaseAdapter, MemoryCalendarOptions, MemoryCalendarResult } from '../types.js';
import { dayBucket, monthBucket, weekBucket } from '../recall/calendar.js';
import { normalizeProjectRootForScope } from '../recall/project-scope.js';
import { resolveTimeRange } from './search.js';

export interface CalendarDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  now?: number;
}

export function handleCalendar(
  deps: CalendarDeps,
  options?: MemoryCalendarOptions,
): MemoryCalendarResult {
  // Query conversation_events and durable_memories separately, then merge counts by bucket key.
}
```

Implementation requirements:

- Filter `conversation_events.project_root` by normalized current project root.
- Filter `durable_memories.project_root` by normalized current project root.
- Use `weekBucket()` when `granularity === 'week'`; do not silently fall back to day/month.
- Pass `{ mode: 'local' }` to bucket helpers for user-facing MCP output.
- Default `timeRange` to `{ relative: 'last_30d' }`.
- Default `granularity` to `day`.
- Add durable `topic_key` values to each bucket's `topicKeys` array, sorted and de-duplicated.
- Sort buckets ascending by `from`.
- Return at most `limit ?? 90` buckets.
- Query time windows use a half-open interval (`>= from` and `< to`) so adjacent
  calendar periods do not double-count boundary timestamps.

Run:

```bash
npm test -- packages/core/tests/tools/calendar.test.ts
```

Expected: PASS.

- [x] **Step D3.4: Register `memory_calendar` MCP tool**

Modify `packages/core/src/server.ts`:

```ts
import { handleCalendar } from './tools/calendar.js';
```

Add tool registration after `memory_recall`:

```ts
server.tool(
  'memory_calendar',
  {
    timeRange: z
      .object({
        from: z.number().optional(),
        to: z.number().optional(),
        relative: z
          .enum(['today', 'yesterday', 'this_week', 'last_7d', 'last_30d', 'this_month', 'last_month'])
          .optional(),
      })
      .optional()
      .describe('Filter memory buckets by time range'),
    granularity: z.enum(['day', 'week', 'month']).optional(),
    limit: z.number().optional(),
  },
  async ({ timeRange, granularity, limit }) => {
    const now = Date.now();
    runPreQueryCodexFlow(now);
    const result = handleCalendar(
      { db, projectRoot: root, now },
      { timeRange, granularity, limit },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  },
);
```

Behavior note: `memory_calendar` is a read-style tool, but it intentionally runs the same debounced pre-query Codex import/ingest flow as `memory_search` and `memory_recall` so broad period discovery sees the newest session data. This must stay debounced and non-blocking on import/ingest failure.

Run:

```bash
npm test -- packages/core/tests/integration/server.test.ts packages/core/tests/tools/calendar.test.ts
```

Expected: PASS and registered tools include `memory_calendar`.

- [x] **Step D3.5: Commit calendar discovery**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/tools/calendar.ts packages/core/src/server.ts packages/core/tests/tools/calendar.test.ts packages/core/tests/integration/server.test.ts
git commit -m "feat(core): expose memory calendar"
```

Completion evidence (2026-06-04):

```bash
npm test -- packages/core/tests/tools/calendar.test.ts packages/core/tests/integration/server.test.ts
# RED before implementation: FAIL because tools/calendar.ts was missing and memory_calendar was not registered

npm test -- packages/core/tests/tools/calendar.test.ts packages/core/tests/integration/server.test.ts
# PASS: 2 files, 25 tests

npm -w @locus/core run typecheck
# PASS

npm test -- packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts
# PASS: 2 files, 11 tests

git diff --check
# PASS
```

---

## Task D4: Project-Scoped Recall And Ranking v3

**Files:**
- Modify: `docs/roadmap/codex-next.md`
- Modify: `docs/superpowers/plans/2026-05-30-track-d-codex-memory-reliability.md`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/recall/engine.ts`
- Modify: `packages/core/src/recall/candidate-loader.ts`
- Modify: `packages/core/src/recall/scoring.ts`
- Modify: `packages/core/src/recall/result-builder.ts`
- Modify: `packages/core/src/tools/recall.ts`
- Modify: `packages/core/src/tools/search.ts`
- Modify: `packages/core/src/tools/timeline.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/tools/recall.test.ts`
- Test: `packages/core/tests/tools/search-project-scope.test.ts`
- Test: `packages/core/tests/tools/timeline-project-scope.test.ts`
- Test: `packages/core/tests/recall/scoring.test.ts`
- Test: `packages/core/tests/integration/server.test.ts`
- Test: `packages/core/tests/integration/track-c-recall-acceptance.test.ts`
- Test: `packages/core/tests/integration/track-d-memory-reliability.test.ts`

- [x] **Step D4.1: Write failing cross-project recall test**

Create `packages/core/tests/integration/track-d-memory-reliability.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleRecall } from '../../src/tools/recall.js';
import type { MemoryRecallResult } from '../../src/types.js';

describe('Track D memory reliability', () => {
  let dir: string;
  let db: NodeSqliteAdapter;
  const now = Date.parse('2026-05-30T12:00:00.000Z');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-track-d-'));
    // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
    const sqlite = require('node:sqlite') as any;
    db = new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not return unrelated project memories for current-project recall', () => {
    const may12 = Date.parse('2026-05-12T10:00:00.000Z');
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['locus-1', 'codex', null, 'c:/repo/locus', 'sess-locus', may12, 'session_end', '{"summary":"Locus v3.6.1 CODEX_HOME hotfix."}', 'high', null, may12],
    );
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['vpn-1', 'codex', null, 'c:/repo/proxyvpn', 'sess-vpn', may12, 'session_end', '{"summary":"ProxyVpn v3 route update."}', 'high', null, may12],
    );

    const result = handleRecall(
      'вспомни работу в этом месяце по v3',
      { db, now, projectRoot: 'C:/repo/locus' },
      { limit: 10, now },
    ) as MemoryRecallResult;

    const text = JSON.stringify(result).toLowerCase();
    expect(text).toContain('locus');
    expect(text).not.toContain('proxyvpn');
  });
});
```

Run:

```bash
npm test -- packages/core/tests/integration/track-d-memory-reliability.test.ts
```

Expected: FAIL until recall accepts and applies `projectRoot`.

- [x] **Step D4.2: Add project fields to recall types**

Modify `packages/core/src/types.ts`:

```ts
export interface MemoryRecallCandidate {
  projectRoot?: string;
  localDate?: string;
  weekKey?: string;
  monthKey?: string;
  sessionId?: string;
  headline: string;
  whyMatched: string;
  eventIds: string[];
  durableMemoryIds: number[];
  intent?: MemoryRecallIntent;
  confidence?: MemoryRecallConfidence;
  score?: number;
  topicKey?: string;
  matchedTerms?: string[];
  captureReason?: string;
  sourceKind?: 'durable' | 'conversation' | 'semantic';
  timestamp?: number;
}

export interface MemoryRecallResult {
  status: MemoryRecallStatus;
  question: string;
  resolvedRange?: MemoryRecallResolvedRange;
  searchedDateBuckets?: MemoryDateBucket[];
  summary: string;
  candidates: MemoryRecallCandidate[];
  matchedIntent?: MemoryRecallIntent;
  matchedTopics?: string[];
  confidence?: MemoryRecallConfidence;
  candidateGroups?: MemoryRecallCandidateGroup[];
}
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS after downstream code compiles.

- [x] **Step D4.3: Pass projectRoot through recall engine**

Modify `packages/core/src/recall/engine.ts`:

```ts
export interface RecallEngineDeps {
  db: DatabaseAdapter;
  now?: number;
  projectRoot?: string;
}
```

Pass `projectRoot: deps.projectRoot` to `loadRecallCandidates`.

Modify `packages/core/src/tools/recall.ts` so `handleRecall` deps include `projectRoot?: string`.

Modify `packages/core/src/server.ts`:

```ts
const result = handleRecall(
  question,
  { db, now, projectRoot: root },
  { timeRange, limit, now },
);
```

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
```

Expected: PASS after candidate loader changes in the next step.

- [x] **Step D4.4: Filter durable, semantic, and conversation candidates by project**

Modify `packages/core/src/recall/candidate-loader.ts`:

- Add `projectRoot?: string` to `CandidateLoaderOptions`.
- Use `buildProjectScopeClause` for:
  - `conversation_events.project_root`
  - `durable_memories.project_root`
  - `memories.project_root`
- Apply `candidateDateFields(row.updated_at)` in `loadDurableCandidates`.
- Apply `candidateDateFields(row.updated_at)` in `loadSemanticCandidates`.
- Apply `candidateDateFields(row.timestamp)` in both `loadConversationCandidates` paths: the term-query SQL path and the timeline fallback path.
- Default strict behavior: if `projectRoot` is present, do not include other projects.
- Include legacy `NULL` project rows only for semantic memories as a second pass when strict project-scoped semantic search returns zero rows and the query has exact term overlap.
- Keep `loadSemanticCandidates` private in `candidate-loader.ts`; implement fallback inside `loadRecallCandidates` so no private helper has to be exported.

Expected SQL addition for conversations:

```ts
if (projectRoot) {
  const scope = buildProjectScopeClause('project_root', projectRoot);
  clauses.push(scope.clause);
  params.push(...scope.params);
}
```

Expected SQL addition for durable memories:

```ts
if (projectRoot) {
  const scope = buildProjectScopeClause('project_root', projectRoot);
  clauses.push(scope.clause);
  params.push(...scope.params);
}
```

Extend the durable row type and SELECT:

```ts
interface DurableRecallRow {
  id: number;
  topic_key: string | null;
  memory_type: DurableMemoryType;
  summary: string;
  updated_at: number;
  project_root: string | null;
}

`SELECT id, topic_key, memory_type, summary, updated_at, project_root
 FROM durable_memories
 WHERE ${clauses.join(' AND ')}
 ORDER BY updated_at DESC, id DESC
 LIMIT ?`
```

Expected durable mapping fields:

```ts
projectRoot: row.project_root ?? undefined,
...candidateDateFields(row.updated_at),
```

Extend the conversation row type and SELECTs:

```ts
interface ConversationRecallRow {
  event_id: string;
  kind: string;
  timestamp: number;
  payload_json: string | null;
  session_id: string | null;
  project_root: string | null;
}

`SELECT event_id, kind, timestamp, payload_json, session_id, project_root
 FROM conversation_events
 WHERE ${clauses.join(' AND ')}
 ORDER BY timestamp DESC, id DESC
 LIMIT ?`
```

Expected conversation mapping fields:

```ts
projectRoot: row.project_root ?? undefined,
...candidateDateFields(row.timestamp),
```

Add private semantic loader options and exact-overlap helpers:

```ts
interface SemanticCandidateLoaderOptions extends CandidateLoaderOptions {
  includeLegacyGlobal?: boolean;
  requireExactTermOverlap?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExactTermOverlap(content: string, terms: readonly string[]): boolean {
  const normalized = content.toLowerCase();
  return terms.some((term) => {
    const escaped = escapeRegExp(term.toLowerCase());
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}([^\\p{L}\\p{N}_-]|$)`, 'u').test(
      normalized,
    );
  });
}
```

Change the private semantic loader signature:

```ts
function loadSemanticCandidates(options: SemanticCandidateLoaderOptions): MemoryRecallCandidate[]
```

Extend the semantic row type and SELECT:

```ts
interface SemanticRecallRow {
  id: number;
  content: string;
  updated_at: number;
  project_root: string | null;
}

`SELECT id, content, updated_at, project_root
 FROM memories
 WHERE ${clauses.join(' AND ')}
 ORDER BY updated_at DESC, id DESC
 LIMIT ?`
```

Inside `loadSemanticCandidates`, apply project scope before the term clauses:

```ts
if (options.projectRoot) {
  const scope = buildProjectScopeClause('project_root', options.projectRoot, {
    includeLegacyGlobal: options.includeLegacyGlobal,
  });
  clauses.push(scope.clause);
  params.push(...scope.params);
}
```

After mapping rows, apply exact-overlap filtering only for the legacy fallback path:

```ts
const candidates = rows
  .map((row) => ({
    projectRoot: row.project_root ?? undefined,
    headline: row.content,
    whyMatched: row.project_root ? `explicit semantic memory ${row.id}` : `legacy semantic memory ${row.id}`,
    eventIds: [],
    durableMemoryIds: [],
    intent: options.parsedQuery.intent,
    matchedTerms: matchingTerms(row.content, options.parsedQuery.termVariants),
    sourceKind: 'semantic' as const,
    timestamp: row.updated_at,
    ...candidateDateFields(row.updated_at),
  }))
  .filter((candidate) => candidate.matchedTerms.length > 0);

return options.requireExactTermOverlap
  ? candidates.filter((candidate) => hasExactTermOverlap(candidate.headline, options.parsedQuery.terms))
  : candidates;
```

Implement the fallback directly in `loadRecallCandidates`:

```ts
const durableCandidates = loadDurableCandidates(options);
const strictSemanticCandidates = loadSemanticCandidates(options);
const semanticCandidates =
  options.projectRoot && strictSemanticCandidates.length === 0
    ? loadSemanticCandidates({
        ...options,
        includeLegacyGlobal: true,
        requireExactTermOverlap: true,
      })
    : strictSemanticCandidates;
const conversationCandidates = loadConversationCandidates(options);

return [...durableCandidates, ...semanticCandidates, ...conversationCandidates];
```

Add date fields when mapping durable, semantic, and conversation candidates:

```ts
import { weekBucket } from './calendar.js';

function candidateDateFields(
  timestamp: number | undefined,
): Pick<MemoryRecallCandidate, 'localDate' | 'weekKey' | 'monthKey'> {
  if (timestamp === undefined) {
    return {};
  }
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    localDate: `${year}-${month}-${day}`,
    weekKey: weekBucket(timestamp, { mode: 'local' }).key,
    monthKey: `${year}-${month}`,
  };
}
```

Update the helper return type to include `weekKey`:

```ts
function candidateDateFields(
  timestamp: number | undefined,
): Pick<MemoryRecallCandidate, 'localDate' | 'weekKey' | 'monthKey'>
```

Add tests:

```ts
it('includes legacy semantic memory only when no scoped semantic match exists', () => {
  // Insert one memories row with project_root NULL and content "legacy CODEX_HOME import".
  // Query from project c:/repo/locus for CODEX_HOME.
  // Expected: legacy row appears only because there is no scoped semantic row.
});

it('prefers scoped semantic memory over legacy global memory', () => {
  // Insert scoped c:/repo/locus memory and legacy NULL memory with the same query term.
  // Expected: scoped row appears and legacy row is excluded.
});
```

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts packages/core/tests/integration/track-d-memory-reliability.test.ts
```

Expected: PASS.

- [x] **Step D4.4a: Scope `memory_search` and `memory_timeline` to the current project**

Modify `packages/core/src/tools/search.ts`:

```ts
export interface SearchOptions {
  timeRange?: TimeRange;
  kind?: EventKind;
  source?: string;
  filePath?: string;
  projectRoot?: string;
  limit?: number;
  offset?: number;
  now?: number;
}
```

Apply `buildProjectScopeClause` to:

- `durable_memories.project_root` in both FTS and LIKE durable paths.
- `memories.project_root` for semantic and episodic memory rows.
- `ce.project_root` in conversation FTS and LIKE paths.

Do not keep calling unscoped `semantic.search(query, 10)` when `projectRoot` is present. Either extend `SemanticMemory.search` to accept `{ projectRoot }`, or replace the search-tool semantic path with scoped SQL against `memories` for Track D.

Implementation rule:

```ts
const projectRoot = options?.projectRoot
  ? normalizeProjectRootForScope(options.projectRoot)
  : undefined;
```

When `projectRoot` is present, `memory_search` must not return other project semantic, durable, episodic, or conversation rows. Structural file search remains repository-local by construction and does not need `project_root`.

Modify `packages/core/src/tools/timeline.ts`:

```ts
export interface TimelineDeps {
  db: DatabaseAdapter;
  projectRoot?: string;
}
```

Add project scope to the timeline query:

```ts
if (deps.projectRoot) {
  const scope = buildProjectScopeClause('ce.project_root', deps.projectRoot);
  clauses.push(scope.clause);
  params.push(...scope.params);
}
```

Modify `packages/core/src/server.ts`:

```ts
const results = handleSearch(query, { db, semantic, fts5 }, { ...options, projectRoot: root });
const entries = handleTimeline({ db, projectRoot: root }, { timeRange, kind, filePath, summary, limit, offset });
```

Create `packages/core/tests/tools/search-project-scope.test.ts`:

```ts
it('memory_search excludes durable and conversation rows from other projects', () => {
  // Insert c:/repo/locus and c:/repo/proxyvpn rows containing the same token.
  // Call handleSearch('TRACKD-SCOPE', { db, semantic, fts5: true }, { projectRoot: 'C:/repo/locus' }).
  // Expected: every result containing TRACKD-SCOPE comes from c:/repo/locus.
});
```

Create `packages/core/tests/tools/timeline-project-scope.test.ts`:

```ts
it('memory_timeline lists only the requested project', () => {
  // Insert two conversation_events in the same month for different project_root values.
  // Call handleTimeline({ db, projectRoot: 'C:/repo/locus' }).
  // Expected: locus event appears and proxyvpn event is absent.
});
```

Run:

```bash
npm test -- packages/core/tests/tools/search-project-scope.test.ts packages/core/tests/tools/timeline-project-scope.test.ts packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts
```

Expected: PASS.

- [x] **Step D4.4b: Make topic namespace isolation explicit**

Track D does not add a separate user-facing topic namespace filter. Instead, topic keys are isolated by `projectRoot`: the same `topic_key` may exist in two projects, but recall/search/timeline/project-state queries must only see the row whose `project_root` matches the current project, except for the documented semantic legacy fallback.

Implementation rules:

- Do not use `topicKey` as a substitute for project isolation.
- Keep `topic_match` as a scoring signal only after project filtering has already happened.
- Durable merge/review queries that operate by `topic_key` must include `project_root` whenever they are called from project-scoped flows.
- Add a follow-up note in `docs/roadmap/codex-next.md` for future user-configurable topic namespace filters if Track D acceptance finds a real need.

Add tests:

```ts
it('keeps same-topic durable memories isolated by project root', () => {
  // Insert active next_step rows with topic_key='track_d_memory_reliability'
  // in c:/repo/locus and c:/repo/proxyvpn.
  // Recall/search from c:/repo/locus must not include the proxyvpn row.
});
```

- [x] **Step D4.5: Add searched date buckets to recall results**

Modify `packages/core/src/recall/result-builder.ts` to accept:

```ts
searchedDateBuckets?: MemoryDateBucket[];
```

Modify `runRecallEngine` to build buckets from matched candidates when `resolvedRange` exists:

```ts
const searchedDateBuckets = resolvedRange
  ? buildBucketsForCandidates(scoredCandidates, resolvedRange)
  : undefined;
```

Implementation rule:

- A period query with no candidates still returns an empty `searchedDateBuckets: []`.
- A period query with candidates groups by `localDate`.

Add this helper to `packages/core/src/recall/engine.ts`:

```ts
import { dayBucket } from './calendar.js';
import type { MemoryDateBucket, MemoryRecallCandidate, MemoryRecallResolvedRange } from '../types.js';

interface BucketAccumulator {
  key: string;
  label: string;
  from: number;
  to: number;
  eventCount: number;
  durableCount: number;
  sessionIds: Set<string>;
  topicKeys: Set<string>;
}

function buildBucketsForCandidates(
  candidates: readonly MemoryRecallCandidate[],
  resolvedRange: MemoryRecallResolvedRange,
): MemoryDateBucket[] {
  const buckets = new Map<string, BucketAccumulator>();

  for (const candidate of candidates) {
    if (candidate.timestamp === undefined) {
      continue;
    }
    if (candidate.timestamp < resolvedRange.from || candidate.timestamp > resolvedRange.to) {
      continue;
    }

    const day = dayBucket(candidate.timestamp, { mode: 'local' });
    const key = candidate.localDate ?? day.key;
    const bucket =
      buckets.get(key) ??
      {
        key,
        label: key,
        from: day.from,
        to: day.to,
        eventCount: 0,
        durableCount: 0,
        sessionIds: new Set<string>(),
        topicKeys: new Set<string>(),
      };

    bucket.eventCount += candidate.eventIds.length;
    bucket.durableCount += candidate.durableMemoryIds.length;
    if (candidate.sessionId) {
      bucket.sessionIds.add(candidate.sessionId);
    }
    if (candidate.topicKey) {
      bucket.topicKeys.add(candidate.topicKey);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => left.from - right.from)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      from: bucket.from,
      to: bucket.to,
      eventCount: bucket.eventCount,
      sessionCount: bucket.sessionIds.size,
      durableCount: bucket.durableCount,
      topicKeys: [...bucket.topicKeys].sort(),
    }));
}
```

Update `BuildRecallResultOptions` and every return branch in `buildRecallResult` to include `searchedDateBuckets` when defined:

```ts
export interface BuildRecallResultOptions {
  question: string;
  candidates: MemoryRecallCandidate[];
  resolvedRange?: MemoryRecallResolvedRange;
  searchedDateBuckets?: MemoryDateBucket[];
  matchedIntent?: MemoryRecallIntent;
  matchedTopics?: string[];
}
```

Call `buildRecallResult` with `searchedDateBuckets` from `runRecallEngine`.

Run:

```bash
npm test -- packages/core/tests/tools/recall.test.ts
```

Expected: PASS and period tests assert `searchedDateBuckets`.

- [x] **Step D4.6: Strengthen ranking v3**

Modify `packages/core/src/recall/scoring.ts`:

Scoring requirements:

- `project_match`: +10
- `project_mismatch`: exclude the candidate in loaders before scoring; do not keep a negative-score fallback.
- `time_range_fit`: +5
- `topic_match`: keep +4
- `exact_entity_match`: +4 for exact path/tag/version strings such as `v3.6.1`, `CODEX_HOME`, `memory_recall`
- `durable_active`: +3 for active durable memory
- `legacy_global`: -4 if `projectRoot` is missing

Final scoring table after Track D:

| Factor | Points | Rule |
| --- | ---: | --- |
| `project_match` | +10 | `candidate.projectRoot` is the current project root after normalization. |
| `time_range_fit` | +5 | `candidate.timestamp` is inside the resolved query range. |
| `completion_event` | +5 | Existing Track C completion-event signal. |
| `topic_match` | +4 | Existing topic hint match against `candidate.topicKey`. |
| `term_overlap` | 0..+4 | Existing bounded term-overlap score. |
| `exact_entity_match` | +4 | Exact version/env/tool/file token from the query is present in the candidate headline or matched terms. |
| `intent_match` | +3 | Existing intent match. |
| `recency` | 0..+3 | Existing bounded recency score. |
| `durable_active` / `durable_priority` | +3 | Durable active memory, preserving the existing durable priority behavior. |
| `validation_command_context` | +3 | Existing validation command context signal. |
| `explicit_memory` | +2 | Existing explicit memory signal. |
| `capture_reason_match` | +2 | Existing capture reason signal. |
| `evidence_present` | +1 | Existing evidence signal. |
| `legacy_global` | -4 | Candidate has no `projectRoot` and survived only through the explicit legacy fallback. |
| `project_mismatch` | n/a | Exclude before scoring, never keep as a large negative score. |

Do not remove existing Track C factors when adding Track D scoring. The implementation should add the new factors to the current `scoreRecallCandidate` path, not replace it with only the table above.

Extend `RecallScoringOptions`:

```ts
export interface RecallScoringOptions {
  now: number;
  projectRoot?: string;
  resolvedRange?: { from: number; to: number };
}

export function filterProjectCandidates(
  candidates: MemoryRecallCandidate[],
  projectRoot?: string,
): MemoryRecallCandidate[]
```

Add exact entity helpers in `packages/core/src/recall/scoring.ts`:

```ts
function exactEntityTokens(values: readonly string[]): string[] {
  return values.filter((value) =>
    /^(?:v?\d+\.\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]{2,}|memory_[a-z_]+|[@\w.-]+\/[\w.-]+|[\w./-]+\.(?:ts|tsx|js|mjs|md|json))$/.test(
      value,
    ),
  );
}

function hasExactEntityMatch(candidate: MemoryRecallCandidate, parsedQuery: ParsedRecallQuery): boolean {
  const rawTokens = parsedQuery.original.split(/\s+/).map((token) => token.replace(/[.,;:!?()[\]{}"']/g, ''));
  const entities = exactEntityTokens([...rawTokens, ...parsedQuery.terms, ...parsedQuery.normalizedTerms]);
  if (entities.length === 0) {
    return false;
  }
  const haystack = [
    candidate.headline,
    ...(candidate.matchedTerms ?? []),
    candidate.topicKey ?? '',
    candidate.captureReason ?? '',
  ].join(' ').toLowerCase();
  return entities.some((entity) => haystack.includes(entity.toLowerCase()));
}
```

Apply new scoring factors in the single-candidate scoring path:

```ts
if (options.projectRoot && candidate.projectRoot && isSameProjectRoot(candidate.projectRoot, options.projectRoot)) {
  score += 10;
}
if (options.resolvedRange && candidate.timestamp !== undefined) {
  if (candidate.timestamp >= options.resolvedRange.from && candidate.timestamp <= options.resolvedRange.to) {
    score += 5;
  }
}
if (hasExactEntityMatch(candidate, parsedQuery)) {
  score += 4;
}
if (options.projectRoot && !candidate.projectRoot) {
  score -= 4;
}
```

`filterProjectCandidates` keeps candidates with no `projectRoot` for legacy fallback scoring, keeps current-project matches, and drops explicit other-project candidates before score calculation.

Implement it in `packages/core/src/recall/scoring.ts`:

```ts
import { isSameProjectRoot } from './project-scope.js';

export function filterProjectCandidates(
  candidates: MemoryRecallCandidate[],
  projectRoot?: string,
): MemoryRecallCandidate[] {
  if (!projectRoot) {
    return candidates;
  }
  return candidates.filter(
    (candidate) => !candidate.projectRoot || isSameProjectRoot(candidate.projectRoot, projectRoot),
  );
}
```

Modify `packages/core/src/recall/engine.ts` so filtering happens before scoring:

```ts
const loadedCandidates = loadRecallCandidates({
  db: deps.db,
  parsedQuery,
  timeRange,
  now,
  limit,
  projectRoot: deps.projectRoot,
});
const candidates = filterProjectCandidates(loadedCandidates, deps.projectRoot);
const scoredCandidates = scoreRecallCandidates(candidates, parsedQuery, {
  now,
  projectRoot: deps.projectRoot,
  resolvedRange: resolvedRange ? { from: resolvedRange.from, to: resolvedRange.to } : undefined,
}).slice(0, limit);
```

Run:

```bash
npm test -- packages/core/tests/recall/scoring.test.ts packages/core/tests/tools/recall.test.ts packages/core/tests/integration/track-d-memory-reliability.test.ts
```

Expected: PASS.

Add this test in `packages/core/tests/recall/scoring.test.ts`:

```ts
it('drops explicit other-project candidates before scoring', () => {
  const kept = filterProjectCandidates(
    [
      {
        projectRoot: 'c:/repo/locus',
        headline: 'Locus memory work',
        whyMatched: 'test',
        eventIds: ['evt-locus'],
        durableMemoryIds: [],
        sourceKind: 'conversation',
      },
      {
        projectRoot: 'c:/repo/proxyvpn',
        headline: 'ProxyVpn memory work',
        whyMatched: 'test',
        eventIds: ['evt-proxy'],
        durableMemoryIds: [],
        sourceKind: 'conversation',
      },
    ],
    'C:/repo/locus',
  );

  expect(kept.map((candidate) => candidate.headline)).toEqual(['Locus memory work']);
});
```

- [x] **Step D4.7: Commit project-scoped recall**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/recall/engine.ts packages/core/src/recall/candidate-loader.ts packages/core/src/recall/scoring.ts packages/core/src/recall/result-builder.ts packages/core/src/tools/recall.ts packages/core/src/tools/search.ts packages/core/src/tools/timeline.ts packages/core/src/server.ts packages/core/tests/tools/recall.test.ts packages/core/tests/tools/search-project-scope.test.ts packages/core/tests/tools/timeline-project-scope.test.ts packages/core/tests/recall/scoring.test.ts packages/core/tests/integration/track-d-memory-reliability.test.ts
git commit -m "feat(core): scope recall to current project"
```

Completed 2026-06-04:

- `npm test -- packages/core/tests/integration/track-d-memory-reliability.test.ts packages/core/tests/tools/search-project-scope.test.ts packages/core/tests/tools/timeline-project-scope.test.ts packages/core/tests/recall/scoring.test.ts packages/core/tests/tools/recall.test.ts` - PASS, 5 files / 31 tests.
- `npm test -- packages/core/tests/tools/search.test.ts packages/core/tests/tools/timeline.test.ts packages/core/tests/integration/server.test.ts` - PASS, 3 files / 67 tests.
- `npm test -- packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/tests/integration/codex-import-tool.test.ts` - PASS, 2 files / 10 tests.
- `npm -w @locus/core run typecheck` - PASS.
- `git diff --check` - PASS.

---

## Task D5: Codex Freshness And Surface Truth

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/tools/codex-diagnostics.ts`
- Modify: `packages/core/src/tools/status.ts`
- Modify: `packages/core/src/tools/doctor.ts`
- Modify: `packages/shared-runtime/detect-client.js`
- Modify: `packages/shared-runtime/detect-client.d.ts`
- Test: `packages/core/tests/tools/codex-diagnostics.test.ts`
- Test: `packages/core/tests/tools/status.test.ts`
- Test: `packages/core/tests/tools/doctor.test.ts`
- Test: `packages/core/tests/shared-runtime/detect-client.test.ts`

- [ ] **Step D5.1: Add surface override tests**

Extend `packages/core/tests/shared-runtime/detect-client.test.ts`:

```ts
it('honors an explicit Locus Codex surface override', async () => {
  const { detectClientRuntime } = await import('@locus/shared-runtime');
  expect(
    detectClientRuntime({
      CODEX_HOME: 'C:/Users/Admin/.codex',
      LOCUS_CODEX_SURFACE: 'desktop',
    }).surface,
  ).toBe('desktop');
});

it('falls back to cli when CODEX_HOME is the only Codex evidence', async () => {
  const { detectClientRuntime } = await import('@locus/shared-runtime');
  expect(detectClientRuntime({ CODEX_HOME: 'C:/Users/Admin/.codex' }).surface).toBe('cli');
});
```

Run:

```bash
npm test -- packages/core/tests/shared-runtime/detect-client.test.ts
```

Expected: FAIL until shared runtime supports the override.

- [ ] **Step D5.2: Implement explicit Codex surface override**

Modify `packages/shared-runtime/detect-client.js`:

```js
function codexSurfaceFromEnv(env) {
  const value = env.LOCUS_CODEX_SURFACE;
  if (value === 'desktop' || value === 'extension' || value === 'cli') {
    return value;
  }
  return 'cli';
}
```

Use it when `CODEX_HOME` is present:

```js
const surface = codexSurfaceFromEnv(env);
return {
  client: 'codex',
  surface,
  detected: true,
  evidence: surface === 'cli' ? ['env:CODEX_HOME'] : ['env:CODEX_HOME', `env:LOCUS_CODEX_SURFACE=${surface}`],
};
```

Update `packages/shared-runtime/detect-client.d.ts` only if exported typedef comments need the env key documented.

Documentation rule: `LOCUS_CODEX_SURFACE` is a diagnostic/debug override used to validate Desktop and extension surfaces before upstream exposes stronger surface evidence. It is not a normal user-facing configuration knob. Document that an accidental value can make status/doctor report the overridden surface.

Run:

```bash
npm test -- packages/core/tests/shared-runtime/detect-client.test.ts
npm -w @locus/core run typecheck
```

Expected: PASS.

- [ ] **Step D5.3: Add freshness snapshot types**

Modify `packages/core/src/types.ts`:

```ts
export type CodexDesktopParity = 'unverified' | 'observed_mcp' | 'validated';

export interface CodexFreshnessSnapshot {
  checkedAt: number;
  client: ClientEnv;
  clientSurface: ClientSurface;
  latestRolloutPath?: string;
  latestRolloutTimestamp?: number;
  latestImportedTimestamp?: number;
  importedEventCount: number;
  freshnessThresholdMs: number;
  fresh: boolean;
  lagMs?: number;
  message: string;
}

export interface MemoryStatus {
  codexFreshness?: CodexFreshnessSnapshot;
}
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS after consumers are updated.

- [ ] **Step D5.4: Build freshness from diagnostics and imported event timestamps**

Modify `packages/core/src/tools/codex-diagnostics.ts` to compute `latestRolloutTimestamp` from the newest rollout file's newest JSONL event timestamp, with file mtime only as a fallback when no parseable timestamp exists.

Dependency boundary note: `@locus/core` already depends on `@locus/codex`, and `parseCodexJsonl` is exported from `@locus/codex`, so this import does not create a new workspace cycle. Do not move the parser into `@locus/shared-runtime` in Track D unless an implementation build proves a real cycle or packaging issue.

```ts
import { readFileSync, statSync } from 'node:fs';
import { parseCodexJsonl } from '@locus/codex';

function timestampFromValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function latestCodexRolloutEventTimestamp(filePath: string): number | undefined {
  const parsed = parseCodexJsonl(readFileSync(filePath, 'utf8'), filePath);
  const timestamps = parsed.records
    .map((record) => timestampFromValue(record.raw.timestamp))
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

const latestRolloutTimestamp = latestRolloutPath
  ? (latestCodexRolloutEventTimestamp(latestRolloutPath) ?? statSync(latestRolloutPath).mtimeMs)
  : undefined;
```

Extend `CodexDiagnosticsSnapshot` with `latestRolloutTimestamp?: number`.

Add tests in `packages/core/tests/tools/codex-diagnostics.test.ts`:

```ts
it('uses the newest rollout event timestamp before file mtime for freshness', () => {
  const codexHome = join(dir, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(sessionsDir, { recursive: true });
  const rolloutPath = join(sessionsDir, 'rollout-track-d-freshness.jsonl');
  const eventTimestamp = Date.parse('2026-05-30T10:00:00.000Z');
  writeFileSync(
    rolloutPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-30T10:00:00.000Z',
        session_id: 'sess-track-d-freshness',
        cwd: 'C:\\Projects\\Locus',
        model: 'gpt-5.4',
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  const newerMtime = new Date('2026-05-30T11:00:00.000Z');
  utimesSync(rolloutPath, newerMtime, newerMtime);

  const diagnostics = collectCodexDiagnostics({
    db,
    env: { CODEX_HOME: codexHome },
  });

  expect(diagnostics?.latestRolloutTimestamp).toBe(eventTimestamp);
});
```

Use a configurable threshold in `packages/core/src/tools/status.ts`:

```ts
const DEFAULT_CODEX_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000;

function codexFreshnessThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LOCUS_CODEX_FRESHNESS_THRESHOLD_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CODEX_FRESHNESS_THRESHOLD_MS;
}
```

Modify `packages/core/src/tools/status.ts`:

```ts
function buildCodexFreshness(
  diagnostics: CodexDiagnosticsSnapshot | undefined,
  checkedAt: number,
  freshnessThresholdMs = codexFreshnessThresholdMs(),
): CodexFreshnessSnapshot | undefined {
  if (!diagnostics) return undefined;
  const latestRolloutTimestamp = diagnostics.latestRolloutTimestamp;
  const latestImportedTimestamp = diagnostics.latestImportedTimestamp;
  const lagMs =
    latestRolloutTimestamp !== undefined && latestImportedTimestamp !== undefined
      ? Math.max(0, latestRolloutTimestamp - latestImportedTimestamp)
      : undefined;
  const fresh =
    lagMs !== undefined ? lagMs <= freshnessThresholdMs : diagnostics.importedEventCount > 0;
  return {
    checkedAt,
    client: diagnostics.client,
    clientSurface: diagnostics.clientSurface,
    latestRolloutPath: diagnostics.latestRolloutPath,
    latestRolloutTimestamp,
    latestImportedTimestamp,
    importedEventCount: diagnostics.importedEventCount,
    freshnessThresholdMs,
    fresh,
    lagMs,
    message: fresh ? 'Codex import appears fresh.' : 'Codex import may be stale.',
  };
}
```

Run:

```bash
npm test -- packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts
```

Expected: PASS with new assertions.

- [ ] **Step D5.5: Update doctor desktop and freshness checks**

Modify `packages/core/src/tools/doctor.ts`:

- If `clientSurface === 'desktop'` and imported events exist, `Codex desktop parity` should be `ok` with message `Codex Desktop MCP path has retained Codex events in this environment.`
- If `clientSurface !== 'desktop'`, keep the warning.
- Add `Codex freshness` check using `latestRolloutTimestamp`, `latestImportedTimestamp`, and lag.

Run:

```bash
npm test -- packages/core/tests/tools/doctor.test.ts
```

Expected: PASS.

- [ ] **Step D5.6: Commit freshness and surface truth**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/tools/codex-diagnostics.ts packages/core/src/tools/status.ts packages/core/src/tools/doctor.ts packages/shared-runtime/detect-client.js packages/shared-runtime/detect-client.d.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/shared-runtime/detect-client.test.ts
git commit -m "feat(codex): report freshness and desktop surface"
```

---

## Task D6: Project State Summary And Verification Tool

**Files:**
- Create: `packages/core/src/tools/project-state.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/memory/durable-merge.ts`
- Modify: `packages/core/src/memory/durable-runner.ts`
- Modify: `packages/core/src/memory/topic-key-registry.ts`
- Modify: `packages/core/src/server.ts`
- Test: `packages/core/tests/tools/project-state.test.ts`
- Test: `packages/core/tests/memory/durable-merge.test.ts`
- Test: `packages/core/tests/memory/durable-runner.test.ts`
- Test: `packages/core/tests/memory/topic-key-registry.test.ts`
- Test: `packages/core/tests/integration/server.test.ts`

- [ ] **Step D6.1: Add project-state types**

Modify `packages/core/src/types.ts`:

```ts
export interface MemoryProjectStateResult {
  projectRoot: string;
  projectHash: string;
  packageName?: string;
  packageVersion?: string;
  gitHead?: string;
  gitBranch?: string;
  dirty?: boolean;
  activeDurableCount: number;
  latestConversationTimestamp?: number;
  latestConversationIso?: string;
  warnings: string[];
  nextSteps: string[];
}
```

Run:

```bash
npm -w @locus/core run typecheck
```

Expected: PASS after handler exists or imports are not yet added.

- [ ] **Step D6.2: Write failing project-state tests**

Create `packages/core/tests/tools/project-state.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleProjectState } from '../../src/tools/project-state.js';

describe('handleProjectState', () => {
  let dir: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-project-state-'));
    mkdirSync(join(dir, 'repo'), { recursive: true });
    writeFileSync(
      join(dir, 'repo', 'package.json'),
      JSON.stringify({ name: 'locus-memory', version: '3.7.0' }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
    const sqlite = require('node:sqlite') as any;
    db = new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('summarizes package metadata and memory freshness', () => {
    const ts = Date.parse('2026-05-30T10:00:00.000Z');
    db.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['evt-1', 'codex', null, join(dir, 'repo').replace(/\\/g, '/').toLowerCase(), 'sess-1', ts, 'session_end', '{"summary":"Track D planned."}', 'high', null, ts],
    );

    const result = handleProjectState({ db, projectRoot: join(dir, 'repo') });

    expect(result).toMatchObject({
      projectHash: expect.stringMatching(/^[a-f0-9]{16}$/),
      packageName: 'locus-memory',
      packageVersion: '3.7.0',
      activeDurableCount: 0,
      latestConversationIso: '2026-05-30T10:00:00.000Z',
    });
  });

  it('reports git state and active durable next steps', () => {
    const ts = Date.parse('2026-05-30T10:00:00.000Z');
    const normalizedRoot = join(dir, 'repo').replace(/\\/g, '/').toLowerCase();
    db.run(
      `INSERT INTO durable_memories
       (topic_key, memory_type, state, summary, evidence_json, source_event_id, source, superseded_by_id, created_at, updated_at, project_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'track_d_memory_reliability',
        'next_step',
        'active',
        'Implement Track D project-scoped recall tests.',
        '{"source":"test"}',
        'evt-1',
        'codex',
        null,
        ts,
        ts,
        normalizedRoot,
      ],
    );

    const result = handleProjectState({
      db,
      projectRoot: join(dir, 'repo'),
      readGitState: () => ({ gitHead: 'abc1234', gitBranch: 'codex/track-d', dirty: true }),
    });

    expect(result).toMatchObject({
      gitHead: 'abc1234',
      gitBranch: 'codex/track-d',
      dirty: true,
      nextSteps: ['Implement Track D project-scoped recall tests.'],
    });
  });
});
```

Run:

```bash
npm test -- packages/core/tests/tools/project-state.test.ts
```

Expected: FAIL because handler does not exist.

- [ ] **Step D6.3: Implement `handleProjectState`**

Create `packages/core/src/tools/project-state.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectHash } from '@locus/shared-runtime';
import type { DatabaseAdapter, MemoryProjectStateResult } from '../types.js';
import { normalizeProjectRootForScope } from '../recall/project-scope.js';

export interface ProjectGitState {
  gitHead?: string;
  gitBranch?: string;
  dirty?: boolean;
  timedOut?: boolean;
  unavailable?: boolean;
}

export interface ProjectStateDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  readGitState?: (cwd: string) => ProjectGitState;
}

const GIT_STATE_CACHE_MS = 5_000;
let gitStateCache: { cwd: string; checkedAt: number; state: ProjectGitState } | undefined;

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 750,
  }).trim();
}

export function resetProjectStateGitCacheForTests(): void {
  gitStateCache = undefined;
}

function readGitState(cwd: string): ProjectGitState {
  const now = Date.now();
  if (gitStateCache && gitStateCache.cwd === cwd && now - gitStateCache.checkedAt < GIT_STATE_CACHE_MS) {
    return gitStateCache.state;
  }

  try {
    const state = {
      gitHead: gitOutput(cwd, ['rev-parse', '--short', 'HEAD']),
      gitBranch: gitOutput(cwd, ['branch', '--show-current']),
      dirty: gitOutput(cwd, ['status', '--porcelain', '--untracked-files=no']).length > 0,
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  } catch (error) {
    const state = {
      timedOut: error instanceof Error && /timeout/i.test(error.message),
      unavailable: true,
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  }
}

export function handleProjectState(deps: ProjectStateDeps): MemoryProjectStateResult {
  const projectRoot = normalizeProjectRootForScope(deps.projectRoot);
  const packagePath = join(deps.projectRoot, 'package.json');
  const packageJson = existsSync(packagePath)
    ? (JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string; version?: string })
    : {};
  const activeDurableCount =
    deps.db.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM durable_memories WHERE state = ? AND project_root = ?',
      ['active', projectRoot],
    )?.cnt ?? 0;
  const latest = deps.db.get<{ timestamp: number }>(
    'SELECT timestamp FROM conversation_events WHERE project_root = ? ORDER BY timestamp DESC LIMIT 1',
    [projectRoot],
  );
  const nextSteps = deps.db
    .all<{ summary: string }>(
      `SELECT summary
       FROM durable_memories
       WHERE memory_type = 'next_step' AND state = 'active' AND project_root = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 5`,
      [projectRoot],
    )
    .map((row) => row.summary);
  const git = (deps.readGitState ?? readGitState)(deps.projectRoot);
  const warnings = [
    ...(latest ? [] : ['No conversation events found for this project.']),
    ...(git.timedOut ? ['Git state lookup timed out; repo state may be incomplete.'] : []),
    ...(!git.timedOut && git.unavailable ? ['Git state lookup failed; repo state may be incomplete.'] : []),
  ];

  return {
    projectRoot,
    projectHash: projectHash(projectRoot),
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    gitHead: git.gitHead,
    gitBranch: git.gitBranch,
    dirty: git.dirty,
    activeDurableCount,
    latestConversationTimestamp: latest?.timestamp,
    latestConversationIso: latest ? new Date(latest.timestamp).toISOString() : undefined,
    warnings,
    nextSteps,
  };
}
```

Test requirements:

- Inject `readGitState` for ordinary project-state tests so they do not depend on the local git binary.
- Add one narrow cache test for the production `readGitState` path and call `resetProjectStateGitCacheForTests()` in `afterEach`.
- Assert that timeout/failed git inspection returns a warning instead of blocking the MCP handler.

Run:

```bash
npm test -- packages/core/tests/tools/project-state.test.ts
```

Expected: PASS.

- [ ] **Step D6.4: Register `memory_project_state`**

Modify `packages/core/src/server.ts`:

```ts
import { handleProjectState } from './tools/project-state.js';
```

Register:

```ts
server.tool('memory_project_state', {}, async () => {
  const result = handleProjectState({ db, projectRoot: root });
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
});
```

Run:

```bash
npm test -- packages/core/tests/integration/server.test.ts packages/core/tests/tools/project-state.test.ts
```

Expected: PASS.

- [ ] **Step D6.4a: Keep resolved next steps accurate**

Modify `packages/core/src/memory/topic-key-registry.ts` so Track D next-step and validation facts share a stable topic. Add the new union member:

```ts
export type CanonicalTopicKey =
  | 'auth_strategy'
  | 'capture_strategy'
  | 'codex_hooks_strategy'
  | 'database_choice'
  | 'track_c_acceptance'
  | 'track_d_memory_reliability'
  | 'user_workflow_style';
```

Append this rule to `TOPIC_KEY_RULES`:

```ts
{
  key: 'track_d_memory_reliability',
  memoryTypes: ['next_step', 'validation_fact', 'decision'],
  any: ['track d', 'memory reliability', 'project-scoped recall', 'date buckets', 'memory_calendar'],
  all: [['track d', 'memory', 'recall']],
},
```

Add a topic registry test:

```ts
expect(
  deriveCanonicalTopicKey({
    memoryType: 'validation_fact',
    summary: 'Validation passed: Track D memory recall project-scoped tests.',
  }),
).toBe('track_d_memory_reliability');
```

Add tests in `packages/core/tests/memory/durable-merge.test.ts`:

```ts
it('supersedes an active next_step when a same-topic validation_fact resolves it', () => {
  const decision = mergeDurableCandidate(
    [
      {
        id: 10,
        topicKey: 'track_d_memory_reliability',
        memoryType: 'next_step',
        state: 'active',
        summary: 'Implement Track D project-scoped recall tests.',
        evidence: { source: 'test' },
        sourceEventId: 'evt-old',
        source: 'codex',
        supersededById: undefined,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    {
      topicKey: 'track_d_memory_reliability',
      memoryType: 'validation_fact',
      summary: 'Validation passed: Track D project-scoped recall tests.',
      evidence: { source: 'test', confidence: 0.9 },
      sourceEventId: 'evt-new',
      source: 'codex',
    },
  );

  expect(decision).toEqual({ action: 'supersede_existing', existingId: 10 });
});
```

Add negative-case tests before implementation:

```ts
it('does not supersede next_step when validation wording is negative', () => {
  const decision = mergeDurableCandidate(
    [
      {
        id: 10,
        topicKey: 'track_d_memory_reliability',
        memoryType: 'next_step',
        state: 'active',
        summary: 'Pass Track D review.',
        evidence: { source: 'test' },
        sourceEventId: 'evt-old',
        source: 'codex',
        supersededById: undefined,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    {
      topicKey: 'track_d_memory_reliability',
      memoryType: 'validation_fact',
      summary: "This hasn't passed review yet.",
      evidence: { source: 'test', confidence: 0.9 },
      sourceEventId: 'evt-new',
      source: 'codex',
    },
  );

  expect(decision.action).not.toBe('supersede_existing');
});
```

Modify `packages/core/src/memory/durable-merge.ts` before the existing same-type matching logic:

```ts
function isPositiveValidationSummary(summary: string): boolean {
  const normalized = summary.toLowerCase();
  if (/\b(?:not|never|failed|failing|blocked|hasn['’]?t|haven['’]?t|isn['’]?t|wasn['’]?t)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:passed|validated|released|published|shipped|done|completed|finished|resolved)\b/.test(
    normalized,
  );
}

const resolvedNextStep = activeEntries.find(
  (entry) =>
    candidate.memoryType === 'validation_fact' &&
    entry.memoryType === 'next_step' &&
    candidate.topicKey &&
    entry.topicKey === candidate.topicKey &&
    isPositiveValidationSummary(candidate.summary),
);
if (resolvedNextStep) {
  return { action: 'supersede_existing', existingId: resolvedNextStep.id };
}
```

Create `packages/core/tests/memory/durable-runner.test.ts` if it does not exist, and add this runner test:

```ts
it('supersedes resolved next_step memories during extraction', () => {
  const ts = Date.parse('2026-05-30T10:00:00.000Z');
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'evt-next',
      'codex',
      null,
      'c:/repo/locus',
      'sess-1',
      ts,
      'session_end',
      '{"summary":"Next step: implement Track D memory recall project-scoped tests."}',
      'high',
      null,
      ts,
    ],
  );
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'evt-validation',
      'codex',
      null,
      'c:/repo/locus',
      'sess-1',
      ts + 1000,
      'session_end',
      '{"summary":"Validation passed: Track D memory recall project-scoped tests."}',
      'high',
      null,
      ts + 1000,
    ],
  );

  const metrics = runDurableExtraction(db);
  const rows = db.all<{ memory_type: string; state: string; superseded_by_id: number | null }>(
    `SELECT memory_type, state, superseded_by_id
     FROM durable_memories
     WHERE topic_key = ?
     ORDER BY id ASC`,
    ['track_d_memory_reliability'],
  );

  expect(metrics.superseded).toBe(1);
  expect(rows).toEqual([
    expect.objectContaining({ memory_type: 'next_step', state: 'superseded' }),
    expect.objectContaining({ memory_type: 'validation_fact', state: 'active' }),
  ]);
  expect(rows[0]?.superseded_by_id).toBeGreaterThan(0);
});
```

Run:

```bash
npm test -- packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/durable-runner.test.ts packages/core/tests/tools/project-state.test.ts
```

Expected: PASS. This implements the roadmap requirement that resolved blockers/next steps stop looking active when later validation proves them resolved.

- [ ] **Step D6.5: Commit project-state tool**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/tools/project-state.ts packages/core/src/memory/topic-key-registry.ts packages/core/src/memory/durable-merge.ts packages/core/src/memory/durable-runner.ts packages/core/src/server.ts packages/core/tests/tools/project-state.test.ts packages/core/tests/memory/topic-key-registry.test.ts packages/core/tests/memory/durable-merge.test.ts packages/core/tests/memory/durable-runner.test.ts packages/core/tests/integration/server.test.ts
git commit -m "feat(core): add project state memory summary"
```

---

## Task D7: Desktop Marker Acceptance And Docs Truth Pass

**Files:**
- Create: `packages/codex/tests/fixtures/track-d/current-project-may.jsonl`
- Create: `packages/codex/tests/fixtures/track-d/other-project-may.jsonl`
- Create: `packages/codex/tests/fixtures/track-d/desktop-marker.jsonl`
- Modify: `packages/core/tests/integration/track-d-memory-reliability.test.ts`
- Modify: `packages/codex/README.md`
- Modify: `packages/codex/skills/locus-memory/SKILL.md`
- Modify: `README.md`
- Modify: `docs/codex-acceptance-matrix.md`
- Modify: `docs/roadmap/codex-next.md`

- [ ] **Step D7.1: Add Track D JSONL fixtures**

Create three fixtures:

- `current-project-may.jsonl`: `cwd` is `__TRACKD_CURRENT_PROJECT__`, contains `TRACKD-LOCUS-MAY-20260530`.
- `other-project-may.jsonl`: `cwd` is `__TRACKD_OTHER_PROJECT__`, contains `TRACKD-PROXYVPN-NOISE-20260530`.
- `desktop-marker.jsonl`: `cwd` is `__TRACKD_CURRENT_PROJECT__`, contains `TRACKD-DESKTOP-MARKER-20260530`.

The first line in each fixture must be `session_meta` with `cwd`, `session_id`, and `model`. Include at least one `event_msg` user prompt and one `response_item` assistant message.

Do not hardcode this developer machine's absolute paths in fixtures. The integration test should copy the fixture through a helper that replaces placeholders with the temp project paths used by that test:

```ts
function copyTrackDFixture(source: string, destination: string, replacements: Record<string, string>): void {
  const raw = readFileSync(source, 'utf8');
  const rendered = Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(token, value.replace(/\\/g, '\\\\')),
    raw,
  );
  writeFileSync(destination, rendered, 'utf8');
}
```

Run:

```bash
npm test -- packages/codex/tests/normalize.test.ts packages/codex/tests/importer.test.ts
```

Expected: PASS because fixtures do not change code yet.

- [ ] **Step D7.2: Extend Track D integration acceptance**

Add tests to `packages/core/tests/integration/track-d-memory-reliability.test.ts`:

Use sequential execution for this file because these tests mutate `process.env`:

```ts
describe.sequential('Track D memory reliability acceptance', () => {
  // tests below
});
```

```ts
it('recalls current-project month work without other-project noise', async () => {
  const root = makeTempRoot();
  const projectDir = join(root, 'ClaudeMagnificoMem');
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  const otherProjectDir = join(root, 'ProxyVpn');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(otherProjectDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  copyTrackDFixture(join(trackDFixturesDir, 'current-project-may.jsonl'), join(sessionsDir, 'current-project-may.jsonl'), {
    __TRACKD_CURRENT_PROJECT__: projectDir,
    __TRACKD_OTHER_PROJECT__: otherProjectDir,
  });
  copyTrackDFixture(join(trackDFixturesDir, 'other-project-may.jsonl'), join(sessionsDir, 'other-project-may.jsonl'), {
    __TRACKD_CURRENT_PROJECT__: projectDir,
    __TRACKD_OTHER_PROJECT__: otherProjectDir,
  });

  await withEnv(
    { CODEX_HOME: codexHome, LOCUS_CODEX_CAPTURE: 'redacted', LOCUS_CAPTURE_LEVEL: 'redacted' },
    async () => {
      const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
      try {
        await callTextTool(ctx, 'memory_import_codex', {});
        const recallText = await callTextTool(ctx, 'memory_recall', {
          question: 'вспомни работу в этом месяце',
          timeRange: { relative: 'this_month' },
          limit: 10,
        });
        expect(recallText).toContain('TRACKD-LOCUS-MAY-20260530');
        expect(recallText).not.toContain('TRACKD-PROXYVPN-NOISE-20260530');
      } finally {
        ctx.cleanup();
      }
    },
  );
});

it('reports date buckets searched for this month', async () => {
  const root = makeTempRoot();
  const projectDir = join(root, 'ClaudeMagnificoMem');
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  copyTrackDFixture(join(trackDFixturesDir, 'current-project-may.jsonl'), join(sessionsDir, 'current-project-may.jsonl'), {
    __TRACKD_CURRENT_PROJECT__: projectDir,
    __TRACKD_OTHER_PROJECT__: join(root, 'ProxyVpn'),
  });

  await withEnv(
    { CODEX_HOME: codexHome, LOCUS_CODEX_CAPTURE: 'redacted', LOCUS_CAPTURE_LEVEL: 'redacted' },
    async () => {
      const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
      try {
        await callTextTool(ctx, 'memory_import_codex', {});
        const recall = JSON.parse(
          await callTextTool(ctx, 'memory_recall', {
            question: 'вспомни работу в этом месяце',
            timeRange: { relative: 'this_month' },
          }),
        ) as MemoryRecallResult;

        expect(recall.searchedDateBuckets).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: '2026-05-30' })]),
        );
      } finally {
        ctx.cleanup();
      }
    },
  );
});

it('treats explicit desktop surface as observed when LOCUS_CODEX_SURFACE=desktop', async () => {
  const root = makeTempRoot();
  const projectDir = join(root, 'ClaudeMagnificoMem');
  const codexHome = join(root, 'codex-home');
  const sessionsDir = join(codexHome, 'sessions', '2026', '05');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  copyTrackDFixture(join(trackDFixturesDir, 'desktop-marker.jsonl'), join(sessionsDir, 'desktop-marker.jsonl'), {
    __TRACKD_CURRENT_PROJECT__: projectDir,
    __TRACKD_OTHER_PROJECT__: join(root, 'ProxyVpn'),
  });

  await withEnv(
    {
      CODEX_HOME: codexHome,
      LOCUS_CODEX_CAPTURE: 'redacted',
      LOCUS_CAPTURE_LEVEL: 'redacted',
      LOCUS_CODEX_SURFACE: 'desktop',
    },
    async () => {
      const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
      try {
        await callTextTool(ctx, 'memory_import_codex', {});

        const status = JSON.parse(await callTextTool(ctx, 'memory_status', {})) as MemoryStatus;
        expect(status.codexDiagnostics).toMatchObject({ clientSurface: 'desktop' });
        expect(status.codexAutoImport?.clientSurface).toBe('desktop');
        expect((status.codexAutoImport?.lastImported ?? 0) > 0).toBe(true);

        const doctor = JSON.parse(await callTextTool(ctx, 'memory_doctor', {})) as DoctorReport;
        expect(doctor.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Codex desktop parity', status: 'ok' }),
          ]),
        );
      } finally {
        ctx.cleanup();
      }
    },
  );
});

it('calendar runs the same debounced pre-query import flow before reading buckets', async () => {
  // Seed a fresh Codex rollout with TRACKD-CALENDAR-AUTOIMPORT.
  // Call memory_calendar without manual memory_import_codex first.
  // Expected: the marker's date bucket appears and unrelated project buckets do not.
  // Also assert the auto-import snapshot moved to imported/debounced rather than remaining untouched.
});
```

Add this helper to the same test file:

```ts
async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
```

Run:

```bash
npm test -- packages/core/tests/integration/track-d-memory-reliability.test.ts
```

Expected: PASS after Tasks D1-D6.

- [ ] **Step D7.3: Update Codex skill workflow**

Modify `packages/codex/skills/locus-memory/SKILL.md`:

- Add `memory_calendar` before broad period recall when the user asks about a period.
- Add `memory_project_state` for "current state of project" questions.
- State that period recall should report searched date buckets.
- State that current-project recall should not mix other project memories unless the user asks for global recall.

Run:

```bash
npm test -- packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts
```

Expected: PASS after tests are updated to assert the new instructions.

- [ ] **Step D7.4: Update public docs and acceptance matrix**

Modify:

- `README.md`
- `packages/codex/README.md`
- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`

Required wording:

- Codex Desktop MCP path is validated when `LOCUS_CODEX_SURFACE=desktop` and Track D marker acceptance passes.
- `LOCUS_CODEX_SURFACE` is a diagnostic/debug override. It can intentionally simulate `desktop`, `extension`, or `cli`, but it can also mislead diagnostics if a user leaves it set accidentally.
- `memory_calendar` is the recommended first tool for broad period questions.
- `memory_calendar` defaults to `last_30d`; agents should pass `this_month`, `last_month`, or an explicit range for user period questions instead of relying on the default.
- `memory_recall` should show searched date buckets for date-scoped queries.
- `memory_project_state` is the recommended current-state summary tool.
- Keep MCP tool-count wording current: D3 raises the documented count from `14` to `15`; D6 should raise it to `16` after `memory_project_state` is added.
- Record evidence anchors as a follow-up if full evidence formatting is not complete in Track D: candidates should at least expose source event IDs/durable IDs and project/date metadata; richer display formatting can ship after the project-scoped behavior is proven.

Run:

```bash
rg -n "memory_calendar|memory_project_state|Codex Desktop|date bucket|project isolation" README.md packages/codex/README.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md packages/codex/skills/locus-memory/SKILL.md
```

Expected: each file contains the relevant new guidance.

- [ ] **Step D7.5: Commit acceptance and docs**

Run:

```bash
git add packages/codex/tests/fixtures/track-d packages/core/tests/integration/track-d-memory-reliability.test.ts packages/codex/skills/locus-memory/SKILL.md packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts README.md packages/codex/README.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md
git commit -m "docs(codex): validate track d memory workflow"
```

---

## Task D8: Final Validation Gate

**Files:**
- Modify only if validation reveals a concrete failing source or doc mismatch, except for planned release metadata/docs updates in D8.5.

- [ ] **Step D8.1: Run focused Track D test set**

Run:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/tools/calendar.test.ts packages/core/tests/tools/project-state.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/integration/track-d-memory-reliability.test.ts packages/codex/tests
```

Expected: PASS.

- [ ] **Step D8.2: Run full repository gate**

Run:

```bash
npm run check
```

Expected: PASS.

- [ ] **Step D8.3: Build generated runtime**

Run:

```bash
npm run build
```

Expected: PASS, and `dist/` updates only if the build process writes generated files.

- [ ] **Step D8.4: Run local MCP smoke in Codex Desktop**

Before the Desktop smoke, record the Codex runtime version and MCP registration view:

```bash
codex --version
codex mcp list
codex mcp get locus
```

Expected: Codex is `0.135.0` or newer for the Track D compatibility smoke, and `locus` is registered as an MCP server. Do not assume a specific Codex-side prefixed tool naming mode; the Locus server-side tool names remain `memory_status`, `memory_calendar`, `memory_recall`, and `memory_project_state`.

Manual smoke from a fresh Codex Desktop session in this repo:

1. Ask Locus for `memory_status`.
2. Ask Locus for `memory_calendar` with this month.
3. Ask Locus `memory_recall`: `вспомни работу в этом месяце`.
4. Ask Locus for `memory_project_state`.

Expected:

- `memory_status.codexDiagnostics.clientSurface` is `desktop` when `LOCUS_CODEX_SURFACE=desktop` is configured.
- `memory_calendar` shows only this project buckets.
- `memory_recall` includes searched date buckets.
- `memory_project_state` returns repo/package state.
- No ProxyVpn or unrelated project memory appears in current-project recall.

- [ ] **Step D8.5: Record validation in roadmap and release notes draft**

Modify `docs/roadmap/codex-next.md` to mark Track D local validation facts once they pass.

If a release note exists for the next release, add a draft under `docs/releases/`.

Prepare the release metadata for the next Codex-first memory reliability release:

- Update root `package.json` from `3.6.1` to `3.7.0`.
- Update workspace package manifests that ship in the Codex-first path: `packages/core/package.json`, `packages/codex/package.json`, `packages/cli/package.json`, and `packages/shared-runtime/package.json`.
- Update `package-lock.json` through the normal npm metadata update path.
- Leave `packages/claude-code/package.json` unchanged unless the release policy explicitly requires all private workspace package versions to move together.
- Add or update `docs/releases/v3.7.0.md` with the Track D validation evidence and the Desktop/CLI scope boundary.

Roadmap follow-up wording:

- Mark project-scoped recall, date buckets, calendar discovery, freshness, and project-state summary only after their tests pass.
- If richer evidence-anchor display is not complete, keep it as an explicit follow-up instead of marking the whole evidence-anchor item done.
- If user-configurable topic namespace filters are not implemented, record them as a follow-up distinct from `projectRoot` isolation.

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended docs/generated files remain.

- [ ] **Step D8.6: Final commit**

Run:

```bash
git add .
git commit -m "chore(codex): validate track d memory reliability"
```

Expected: final validation commit. Do not push or tag without explicit user approval.

---

## Review Gates

- [x] Review this plan before Task D0 is executed.
- [ ] Execute one task at a time.
- [ ] Stop for user review after each commit.
- [ ] Do not start HTML dashboard work until Track D is passing focused acceptance.
- [ ] Do not claim Codex Desktop parity beyond the evidence recorded by Track D tests and the live Desktop smoke.
- [ ] Keep this plan synchronized as implementation progresses: mark completed steps, record verification evidence, and keep docs changes in the same task commit when they describe shipped behavior.

## Validation Matrix

Minimum final evidence:

- [ ] `npm test -- packages/core/tests/recall`
- [ ] `npm test -- packages/core/tests/tools/recall.test.ts`
- [ ] `npm test -- packages/core/tests/tools/calendar.test.ts`
- [ ] `npm test -- packages/core/tests/tools/project-state.test.ts`
- [ ] `npm test -- packages/core/tests/tools/status.test.ts`
- [ ] `npm test -- packages/core/tests/tools/doctor.test.ts`
- [ ] `npm test -- packages/core/tests/tools/codex-diagnostics.test.ts`
- [ ] `npm test -- packages/core/tests/integration/track-d-memory-reliability.test.ts`
- [ ] `npm test -- packages/codex/tests`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] Codex Desktop live MCP smoke

## Self-Review

Spec coverage:

- Project isolation: Tasks D1 and D4, including raw Codex `cwd` normalization into the resolved git-root/marker-root project identity and projectHash visibility.
- Topic namespace: Track D scopes topic-key behavior by `projectRoot`; separate user-configurable topic namespace filters remain a roadmap follow-up unless implementation tests prove they are required.
- Temporal/date-bucket recall: Tasks D2, D3, and D4.
- Calendar discovery: Task D3.
- Freshness/surface truth: Task D5.
- Codex Desktop validation: Tasks D5 and D7.
- Ranking v3: Task D4.
- Project-state summary: Task D6.
- Decision lifecycle/stale handling: Task D6.4a supersedes same-topic active `next_step` rows when later `validation_fact` evidence resolves them; broader stale cleanup remains review-only.
- Evidence anchors: D4 candidate fields and D6 project-state output; if deeper display formatting is not implemented in Track D, keep it as an explicit roadmap follow-up instead of marking it delivered.
- Docs and skill workflow: Task D7.

Placeholder scan:

- No forbidden placeholder markers are present.
- Every implementation task lists exact files and concrete commands.

Type consistency:

- New project root metadata uses `projectRoot` in TypeScript and `project_root` in SQLite.
- Date buckets use `MemoryDateBucket`.
- Calendar tool returns `MemoryCalendarResult`.
- Project state tool returns `MemoryProjectStateResult`.
