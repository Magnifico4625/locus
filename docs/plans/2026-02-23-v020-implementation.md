# Locus v0.2.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the configuration story — wire captureLevel env var, add compact and config tools, improve FTS5 UX, clean up sentinel values.

**Architecture:** 5 independent changes touching server.ts (env override + 2 new tool registrations), 2 new tool handlers, doctor/status improvements, scanner cleanup. Each change is self-contained with TDD.

**Tech Stack:** TypeScript strict, vitest, biome, MCP SDK `server.tool()` pattern

---

### Task 1: Wire `LOCUS_CAPTURE_LEVEL` env var in server.ts

**Files:**
- Modify: `src/server.ts:67`
- Modify: `tests/integration/server.test.ts`

**Context:** `LOCUS_LOG` is already read at line 238 of server.ts. We need the same pattern for `LOCUS_CAPTURE_LEVEL` inside `createServer()` at line 67 where config is created.

**Step 1: Write the failing test**

Add to `tests/integration/server.test.ts`:

```typescript
it('reads LOCUS_CAPTURE_LEVEL from environment', async () => {
  const original = process.env.LOCUS_CAPTURE_LEVEL;
  try {
    process.env.LOCUS_CAPTURE_LEVEL = 'redacted';
    const { cleanup, status } = await createTestServer();
    expect(status.captureLevel).toBe('redacted');
    await cleanup();
  } finally {
    if (original === undefined) {
      delete process.env.LOCUS_CAPTURE_LEVEL;
    } else {
      process.env.LOCUS_CAPTURE_LEVEL = original;
    }
  }
});

it('ignores invalid LOCUS_CAPTURE_LEVEL values', async () => {
  const original = process.env.LOCUS_CAPTURE_LEVEL;
  try {
    process.env.LOCUS_CAPTURE_LEVEL = 'invalid';
    const { cleanup, status } = await createTestServer();
    expect(status.captureLevel).toBe('metadata');
    await cleanup();
  } finally {
    if (original === undefined) {
      delete process.env.LOCUS_CAPTURE_LEVEL;
    } else {
      process.env.LOCUS_CAPTURE_LEVEL = original;
    }
  }
});
```

Note: `createTestServer` is a helper that calls `createServer()` and then calls `memory_status`. Adapt to the existing test pattern in `server.test.ts`. If the test file doesn't have a `createTestServer` helper, the test should call `createServer()` directly, invoke the status handler, and check `captureLevel` in the returned result.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/server.test.ts -t "LOCUS_CAPTURE_LEVEL"`
Expected: FAIL — captureLevel is always `'metadata'` regardless of env var.

**Step 3: Implement the env var override**

In `src/server.ts`, after line 67 (`const config = { ...LOCUS_DEFAULTS };`), add:

```typescript
  // Override captureLevel from environment (mirrors LOCUS_LOG pattern)
  const envCapture = process.env.LOCUS_CAPTURE_LEVEL;
  if (envCapture === 'metadata' || envCapture === 'redacted' || envCapture === 'full') {
    config.captureLevel = envCapture;
  }
```

**Step 4: Run tests**

Run: `npx vitest run tests/integration/server.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/server.ts tests/integration/server.test.ts
git commit -m "feat: wire LOCUS_CAPTURE_LEVEL env var in MCP server"
```

---

### Task 2: Cleanup — NULL sentinels in storeSkippedEntry + denylisted test

**Files:**
- Modify: `src/scanner/index.ts:382-397`
- Modify: `tests/scanner/scan-project.test.ts`
- Create: `tests/fixtures/sample-project/secrets.key` (empty fixture file)

**Context:** `storeSkippedEntry` at line 382 of `src/scanner/index.ts` uses `'typescript'`, `'module'`, `0`, `'high'` as placeholders for skipped files. These should be NULL. Also, the `'denylisted'` skip reason path has no test.

**Step 1: Add a fixture file that triggers isDenylisted**

Create an empty file: `tests/fixtures/sample-project/secrets.key`

This file must hit the `isDenylisted` check (line 475 in scanner/index.ts). The `.key` extension matches the denylist pattern `*.key`.

Important: also add `'secrets.key'` to the fixture paths returned by `fullScanDeps()` mock in the test (around line 12-31 of `scan-project.test.ts`).

**Step 2: Write the failing test for denylisted skip reason**

Add to `tests/scanner/scan-project.test.ts`:

```typescript
it('stores denylisted skip reason for .key files', async () => {
  const result = await scanProject(db, FIXTURE_PATH, config, fullScanDeps());

  // secrets.key should be skipped as 'denylisted'
  expect(result.files.some((f) => f.relativePath.includes('secrets.key'))).toBe(false);

  const rows = db.all<{ relative_path: string; skipped_reason: string | null }>(
    "SELECT relative_path, skipped_reason FROM files WHERE skipped_reason IS NOT NULL",
    [],
  );
  const keyRow = rows.find((r) => r.relative_path === 'secrets.key');
  expect(keyRow).toBeDefined();
  expect(keyRow?.skipped_reason).toBe('denylisted');
});
```

**Step 3: Run test to verify it fails or passes with current code**

Run: `npx vitest run tests/scanner/scan-project.test.ts -t "denylisted"`
Expected: PASS (the code path already works, we're just adding coverage). If it fails, debug.

**Step 4: Write the failing test for NULL sentinels**

Add to `tests/scanner/scan-project.test.ts`:

```typescript
it('stores NULL for language and confidence on skipped entries', async () => {
  const result = await scanProject(db, FIXTURE_PATH, config, fullScanDeps());

  const skippedRows = db.all<{
    relative_path: string;
    language: string | null;
    confidence_level: string | null;
    skipped_reason: string | null;
  }>(
    "SELECT relative_path, language, confidence_level, skipped_reason FROM files WHERE skipped_reason IS NOT NULL",
    [],
  );

  for (const row of skippedRows) {
    expect(row.language).toBeNull();
    expect(row.confidence_level).toBeNull();
  }
});
```

**Step 5: Run test to verify it fails**

Run: `npx vitest run tests/scanner/scan-project.test.ts -t "NULL for language"`
Expected: FAIL — currently `language = 'typescript'` and `confidence_level = 'high'`

**Step 6: Fix storeSkippedEntry**

In `src/scanner/index.ts`, replace the SQL in `storeSkippedEntry` (lines 388-395):

```typescript
  db.run(
    `INSERT OR REPLACE INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines,
      confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, '[]', '[]', '[]', NULL, NULL, 0, NULL, NULL, ?, ?)`,
    [relPath, now, reason],
  );
```

Changes: `'module'` → `NULL`, `'typescript'` → `NULL`, `'high'` → `NULL`. Keep `'[]'` for JSON arrays (avoids NULL JSON parsing issues). Keep `0` for `lines` (integer column, NULL could break queries).

**Step 7: Run all scanner tests**

Run: `npx vitest run tests/scanner/scan-project.test.ts`
Expected: ALL PASS

Check that existing tests still pass — some tests may assert on the old sentinel values. If they do, update those assertions to expect `null`.

**Step 8: Commit**

```bash
git add src/scanner/index.ts tests/scanner/scan-project.test.ts tests/fixtures/sample-project/secrets.key
git commit -m "fix: use NULL for language/confidence on skipped entries, add denylisted test"
```

---

### Task 3: FTS5 fallback documentation in doctor + status

**Files:**
- Modify: `src/tools/doctor.ts:65-75`
- Modify: `src/tools/status.ts`
- Modify: `tests/tools/doctor.test.ts`
- Modify: `tests/tools/status.test.ts`

**Context:** Doctor already shows "not available (using LIKE fallback)" for FTS5 — this is adequate. Status shows `fts5Available: boolean` but doesn't show a human-readable `searchEngine` label. We'll add it.

**Step 1: Write the failing test for status.searchEngine**

Add to `tests/tools/status.test.ts`:

```typescript
it('reports searchEngine as FTS5 when available', () => {
  const deps = makeStatusDeps(adapter, tempDir, { fts5: true });
  const status = handleStatus(deps, config);
  expect(status.searchEngine).toBe('FTS5');
});

it('reports searchEngine as LIKE fallback when FTS5 unavailable', () => {
  const deps = makeStatusDeps(adapter, tempDir, { fts5: false });
  const status = handleStatus(deps, config);
  expect(status.searchEngine).toBe('LIKE fallback');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/status.test.ts -t "searchEngine"`
Expected: FAIL — `searchEngine` property doesn't exist yet.

**Step 3: Add searchEngine to MemoryStatus type**

In `src/types.ts`, add to `MemoryStatus` interface (after line 207):

```typescript
  searchEngine: 'FTS5' | 'LIKE fallback';
```

**Step 4: Add searchEngine to status handler**

In `src/tools/status.ts`, add to the returned object (alongside `fts5Available`):

```typescript
  searchEngine: deps.fts5 ? 'FTS5' : 'LIKE fallback',
```

**Step 5: Run tests**

Run: `npx vitest run tests/tools/status.test.ts`
Expected: ALL PASS

**Step 6: Update doctor FTS5 message (optional improvement)**

In `src/tools/doctor.ts`, update the warn fix message (line 73) to be more helpful:

```typescript
  fix: 'Depends on Node.js SQLite build. Search still works via LIKE fallback.',
```

Update the corresponding test in `tests/tools/doctor.test.ts` — the assertion `expect(ftsCheck?.fix).toContain('FTS5')` should be changed to match the new text:

```typescript
  expect(ftsCheck?.fix).toContain('LIKE fallback');
```

**Step 7: Run all affected tests**

Run: `npx vitest run tests/tools/status.test.ts tests/tools/doctor.test.ts`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/types.ts src/tools/status.ts src/tools/doctor.ts tests/tools/status.test.ts tests/tools/doctor.test.ts
git commit -m "feat: add searchEngine to status, improve FTS5 doctor message"
```

---

### Task 4: `memory_config` tool + skill

**Files:**
- Create: `src/tools/config.ts`
- Create: `tests/tools/config.test.ts`
- Create: `skills/memory-config/SKILL.md`
- Modify: `src/server.ts` (register new tool)

**Context:** New read-only tool that shows current configuration values and their sources (default vs env var). Follow the existing pattern in `src/tools/status.ts` for DI and testing.

**Step 1: Write the failing test**

Create `tests/tools/config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { handleConfig } from '../../src/tools/config.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';
import type { LocusConfig } from '../../src/types.js';

describe('handleConfig', () => {
  const defaultConfig: LocusConfig = { ...LOCUS_DEFAULTS };

  it('returns all config entries', () => {
    const result = handleConfig(defaultConfig, {});
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('each entry has setting, value, and source fields', () => {
    const result = handleConfig(defaultConfig, {});
    for (const entry of result.entries) {
      expect(entry).toHaveProperty('setting');
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('source');
    }
  });

  it('reports default source when no env var is set', () => {
    const result = handleConfig(defaultConfig, {});
    const captureEntry = result.entries.find((e) => e.setting === 'captureLevel');
    expect(captureEntry?.value).toBe('metadata');
    expect(captureEntry?.source).toBe('default');
  });

  it('reports env source when env var overrides config', () => {
    const overriddenConfig: LocusConfig = { ...LOCUS_DEFAULTS, captureLevel: 'redacted' };
    const env = { LOCUS_CAPTURE_LEVEL: 'redacted' };
    const result = handleConfig(overriddenConfig, env);
    const captureEntry = result.entries.find((e) => e.setting === 'captureLevel');
    expect(captureEntry?.value).toBe('redacted');
    expect(captureEntry?.source).toBe('env (LOCUS_CAPTURE_LEVEL)');
  });

  it('reports env source for LOCUS_LOG', () => {
    const overriddenConfig: LocusConfig = { ...LOCUS_DEFAULTS, logLevel: 'debug' };
    const env = { LOCUS_LOG: 'debug' };
    const result = handleConfig(overriddenConfig, env);
    const logEntry = result.entries.find((e) => e.setting === 'logLevel');
    expect(logEntry?.source).toBe('env (LOCUS_LOG)');
  });

  it('includes fts5Available as detected source', () => {
    const result = handleConfig(defaultConfig, {}, true);
    const ftsEntry = result.entries.find((e) => e.setting === 'fts5Available');
    expect(ftsEntry?.value).toBe('true');
    expect(ftsEntry?.source).toBe('detected');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/config.test.ts`
Expected: FAIL — `handleConfig` doesn't exist yet.

**Step 3: Implement handleConfig**

Create `src/tools/config.ts`:

```typescript
import type { LocusConfig } from '../types.js';
import { LOCUS_DEFAULTS } from '../types.js';

interface ConfigEntry {
  setting: string;
  value: string;
  source: string;
}

interface ConfigResult {
  entries: ConfigEntry[];
}

const ENV_MAP: Record<string, string> = {
  captureLevel: 'LOCUS_CAPTURE_LEVEL',
  logLevel: 'LOCUS_LOG',
};

export function handleConfig(
  config: LocusConfig,
  env: Record<string, string | undefined>,
  fts5Available = false,
): ConfigResult {
  const entries: ConfigEntry[] = [];

  for (const [key, value] of Object.entries(config)) {
    const envVar = ENV_MAP[key];
    const defaultValue = LOCUS_DEFAULTS[key as keyof LocusConfig];
    let source = 'default';

    if (envVar && env[envVar] !== undefined) {
      source = `env (${envVar})`;
    } else if (value !== defaultValue) {
      source = 'override';
    }

    entries.push({
      setting: key,
      value: String(value),
      source,
    });
  }

  entries.push({
    setting: 'fts5Available',
    value: String(fts5Available),
    source: 'detected',
  });

  return { entries };
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/tools/config.test.ts`
Expected: ALL PASS

**Step 5: Register tool in server.ts**

Add import at the top of `src/server.ts`:

```typescript
import { handleConfig } from './tools/config.js';
```

Add tool registration after the last existing `server.tool(...)` call (after `memory_purge`):

```typescript
  server.tool('memory_config', 'Show current configuration values and sources', {}, () => {
    const result = handleConfig(config, process.env, fts5);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });
```

Note: `fts5` variable is the boolean already available in `createServer()` scope (from `detectFts5` call).

**Step 6: Create skill file**

Create `skills/memory-config/SKILL.md`:

```markdown
---
name: memory-config
description: Show current Locus configuration values and their sources (default, env var, or detected)
---

Show the current Locus memory configuration. Invoke the `memory_config` MCP tool and display the results as a formatted table.

This is a read-only command — it shows current values but does not change them. To change configuration, set environment variables (`LOCUS_CAPTURE_LEVEL`, `LOCUS_LOG`) and restart Claude Code.
```

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (487+ tests)

**Step 8: Commit**

```bash
git add src/tools/config.ts tests/tools/config.test.ts src/server.ts skills/memory-config/SKILL.md
git commit -m "feat: add memory_config tool and /locus:memory-config skill"
```

---

### Task 5: `memory_compact` tool + skill

**Files:**
- Create: `src/tools/compact.ts`
- Create: `tests/tools/compact.test.ts`
- Create: `skills/compact/SKILL.md`
- Modify: `src/server.ts` (register new tool)

**Context:** New tool for episodic memory cleanup. `EpisodicMemory` (src/memory/episodic.ts) has no delete method, so compact will operate directly on the DB via SQL. Follow the DI pattern from other tools.

**Step 1: Write the failing tests**

Create `tests/tools/compact.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleCompact } from '../../src/tools/compact.js';
import type { DatabaseAdapter } from '../../src/types.js';
// Use the same adapter setup pattern from tests/memory/episodic.test.ts
// Import initStorage or create a test adapter

describe('handleCompact', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    // Initialize in-memory DB with migrations (same pattern as episodic tests)
  });

  afterEach(() => {
    db.close();
  });

  it('returns zero deletedEntries when no episodic data exists', () => {
    const result = handleCompact(db, {});
    expect(result.deletedEntries).toBe(0);
    expect(result.remainingEntries).toBe(0);
    expect(result.remainingSessions).toBe(0);
  });

  it('deletes entries older than maxAgeDays', () => {
    const now = Date.now();
    const oldTime = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago

    // Insert old entry
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'old event', '[]', ?, ?, 'session-old')",
      [oldTime, oldTime],
    );
    // Insert recent entry
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'new event', '[]', ?, ?, 'session-new')",
      [now, now],
    );

    const result = handleCompact(db, { maxAgeDays: 30 });
    expect(result.deletedEntries).toBe(1);
    expect(result.remainingEntries).toBe(1);
  });

  it('keeps entries from recent sessions even if old', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago

    // Insert entries in 3 sessions, all old
    for (let i = 0; i < 3; i++) {
      db.run(
        "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', ?, '[]', ?, ?, ?)",
        [`event-${i}`, oldTime + i * 1000, oldTime + i * 1000, `session-${i}`],
      );
    }

    // keepSessions=5 means keep all 3 (only 3 exist)
    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 5 });
    expect(result.deletedEntries).toBe(0);
    expect(result.remainingSessions).toBe(3);
  });

  it('does not delete semantic memories', () => {
    const now = Date.now();
    const oldTime = now - 60 * 24 * 60 * 60 * 1000;

    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at) VALUES ('semantic', 'decision', '[]', ?, ?)",
      [oldTime, oldTime],
    );
    db.run(
      "INSERT INTO memories (layer, content, tags_json, created_at, updated_at, session_id) VALUES ('episodic', 'old event', '[]', ?, ?, 'sess1')",
      [oldTime, oldTime],
    );

    const result = handleCompact(db, { maxAgeDays: 1, keepSessions: 0 });
    expect(result.deletedEntries).toBe(1);

    // Verify semantic entry still exists
    const semanticCount = db.get<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM memories WHERE layer = 'semantic'",
      [],
    );
    expect(semanticCount?.cnt).toBe(1);
  });

  it('uses default maxAgeDays=30 and keepSessions=5', () => {
    const result = handleCompact(db, {});
    expect(result.deletedEntries).toBe(0);
    // Just verify it doesn't throw with no params
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/compact.test.ts`
Expected: FAIL — `handleCompact` doesn't exist.

**Step 3: Implement handleCompact**

Create `src/tools/compact.ts`:

```typescript
import type { DatabaseAdapter } from '../types.js';

interface CompactParams {
  maxAgeDays?: number;
  keepSessions?: number;
}

interface CompactResult {
  deletedEntries: number;
  remainingEntries: number;
  remainingSessions: number;
}

export function handleCompact(
  db: DatabaseAdapter,
  params: CompactParams,
): CompactResult {
  const maxAgeDays = params.maxAgeDays ?? 30;
  const keepSessions = params.keepSessions ?? 5;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  // Find sessions to keep (most recent N by latest entry timestamp)
  const recentSessions = db.all<{ session_id: string }>(
    `SELECT DISTINCT session_id FROM memories
     WHERE layer = 'episodic' AND session_id IS NOT NULL
     ORDER BY (SELECT MAX(created_at) FROM memories m2 WHERE m2.session_id = memories.session_id) DESC
     LIMIT ?`,
    [keepSessions],
  );
  const keepSessionIds = recentSessions.map((r) => r.session_id);

  // Delete old episodic entries NOT in kept sessions
  let deletedEntries = 0;
  if (keepSessionIds.length > 0) {
    const placeholders = keepSessionIds.map(() => '?').join(',');
    const result = db.run(
      `DELETE FROM memories
       WHERE layer = 'episodic'
         AND created_at < ?
         AND (session_id IS NULL OR session_id NOT IN (${placeholders}))`,
      [cutoff, ...keepSessionIds],
    );
    deletedEntries = result.changes;
  } else {
    const result = db.run(
      `DELETE FROM memories WHERE layer = 'episodic' AND created_at < ?`,
      [cutoff],
    );
    deletedEntries = result.changes;
  }

  // Count remaining
  const remaining = db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM memories WHERE layer = 'episodic'",
    [],
  );
  const sessions = db.get<{ cnt: number }>(
    "SELECT COUNT(DISTINCT session_id) as cnt FROM memories WHERE layer = 'episodic'",
    [],
  );

  return {
    deletedEntries,
    remainingEntries: remaining?.cnt ?? 0,
    remainingSessions: sessions?.cnt ?? 0,
  };
}
```

Note: Check that `db.run()` returns `{ changes: number }` in the existing adapter interface. Look at `src/storage/adapter.ts` or `types.ts` for the `RunResult` type. If `changes` is not available, use a different approach (SELECT COUNT before and after DELETE).

**Step 4: Run tests**

Run: `npx vitest run tests/tools/compact.test.ts`
Expected: ALL PASS

**Step 5: Register tool in server.ts**

Add import:

```typescript
import { handleCompact } from './tools/compact.js';
```

Add tool registration with Zod schema:

```typescript
  server.tool(
    'memory_compact',
    'Clean up old episodic memory entries. Keeps recent sessions.',
    {
      maxAgeDays: z.number().optional().describe('Delete entries older than this (default: 30)'),
      keepSessions: z.number().optional().describe('Always keep this many recent sessions (default: 5)'),
    },
    (params) => {
      const result = handleCompact(db, params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

Note: `db` is the DatabaseAdapter already in scope inside `createServer()`.

**Step 6: Create skill file**

Create `skills/compact/SKILL.md`:

```markdown
---
name: compact
description: Clean up old episodic memory entries to free space. Keeps recent sessions intact.
---

Clean up old episodic memory by invoking the `memory_compact` MCP tool.

By default, removes episodic entries older than 30 days while keeping the 5 most recent sessions intact. Semantic memories (decisions) are never deleted.

Pass `maxAgeDays` and `keepSessions` parameters to customize behavior.
```

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (489+ tests)

**Step 8: Commit**

```bash
git add src/tools/compact.ts tests/tools/compact.test.ts src/server.ts skills/compact/SKILL.md
git commit -m "feat: add memory_compact tool and /locus:compact skill"
```

---

### Task 6: Update README + version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`

**Step 1: Update README.md**

Add `memory_compact` and `memory_config` to the Tools Reference table:

```markdown
| `memory_compact` | `maxAgeDays?: number, keepSessions?: number` | Clean up old episodic memory entries |
| `memory_config` | — | Show current configuration and sources |
```

Update the tool count from 9 to 11 wherever mentioned.

Add a note under the Configuration section about FTS5:

```markdown
**Search Engine:** Locus uses SQLite FTS5 for full-text search when available. If your Node.js build doesn't include FTS5, search automatically falls back to LIKE queries (slower, less accurate). Run `memory_doctor` to check your search engine status.
```

**Step 2: Bump version to 0.2.0**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

In `.claude-plugin/plugin.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

**Step 3: Run lint check**

Run: `npx biome check .`
Expected: No errors.

**Step 4: Run full check**

Run: `npm run check`
Expected: typecheck + lint + all tests pass.

**Step 5: Commit and tag**

```bash
git add README.md package.json .claude-plugin/plugin.json
git commit -m "docs: update README for v0.2.0, bump version"
git tag v0.2.0
```

---

### Task 7: Final verification + push

**Step 1: Run full project check**

Run: `npm run check`
Expected: typecheck + lint + all tests pass (489+ tests).

**Step 2: Build**

Run: `npm run build`
Expected: `dist/server.js` produced without errors.

**Step 3: Verify git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

**Step 4: Push to GitHub**

```bash
git push origin main
git push origin v0.2.0
```

**Step 5: Update marketplace**

Update `C:\Users\Admin\gemini-project\claude-plugins\.claude-plugin\marketplace.json`:
- Change `"version": "0.1.0"` to `"version": "0.2.0"`
- Change `"ref": "v0.1.0"` to `"ref": "v0.2.0"`

Commit and push the marketplace repo.
