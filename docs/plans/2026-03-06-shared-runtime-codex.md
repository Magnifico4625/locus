# Shared Runtime + Codex Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract all hardcoded `~/.claude/` path logic into a shared plain-JS runtime module (`@locus/shared-runtime`), make storage client-aware (Claude Code / Codex / generic), and add a `packages/codex/` skeleton with skill + config examples.

**Architecture:** A new `packages/shared-runtime/` package with plain ESM JavaScript (no TypeScript, no build step). It exports path resolution and client detection functions using only Node.js stdlib (`node:os`, `node:path`, `node:crypto`, `process.env`). Both `@locus/core` (TypeScript) and `@locus/claude-code` (plain JS hooks) import from it via npm workspace symlinks. A new `packages/codex/` skeleton provides Codex CLI skill files and config examples (no adapter logic yet).

**Tech Stack:** Plain ESM JS (.js + .d.ts), Node 22+ stdlib only, npm workspaces, vitest for tests

**Key constraint from reviewer:** `shared-runtime` must be **narrow** — only path resolution, client detection, project hash. No DB, no logger, no config parsing, no scanner logic.

---

## Priority Rules (from reviewer)

1. If explicit `dbPath` is passed to `createServer()`, it overrides everything — resolver is bypassed entirely.
2. `LOCUS_STORAGE_ROOT` env var overrides all auto-detection.
3. `CODEX_HOME` env var signals Codex CLI context.
4. `CLAUDE_PLUGIN_ROOT` env var signals Claude Code plugin context — path stays `~/.claude/memory/`.
5. Default fallback: `~/.locus/memory/` (client-agnostic).

---

## Task 1: Create `packages/shared-runtime/` package scaffold

**Files:**
- Create: `packages/shared-runtime/package.json`
- Create: `packages/shared-runtime/index.js`
- Create: `packages/shared-runtime/index.d.ts`

**Step 1: Create package.json**

```json
{
  "name": "@locus/shared-runtime",
  "version": "3.1.0",
  "type": "module",
  "description": "Shared path resolution and client detection for Locus monorepo",
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "import": "./index.js"
    }
  },
  "files": ["*.js", "*.d.ts"],
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Step 2: Create empty barrel `index.js`**

```js
// @locus/shared-runtime — path resolution + client detection
// Plain ESM JS. Only node:os, node:path, node:crypto, process.env. No build step.
export { detectClientEnv } from './detect-client.js';
export {
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
} from './resolve-storage.js';
export { projectHash } from './project-hash.js';
```

**Step 3: Create matching `index.d.ts`**

```ts
export type ClientEnv = 'claude-code' | 'codex' | 'generic';

export function detectClientEnv(): ClientEnv;

export function resolveStorageRoot(): string;
export function resolveProjectStorageDir(projectRoot: string): string;
export function resolveDbPath(projectRoot: string): string;
export function resolveInboxDir(projectRoot: string): string;
export function resolveLogPath(): string;

export function projectHash(projectRoot: string): string;
```

**Step 4: Verify workspace resolution**

Run: `npm install` (from repo root)
Expected: `node_modules/@locus/shared-runtime` symlink created

---

## Task 2: Implement `project-hash.js`

**Files:**
- Create: `packages/shared-runtime/project-hash.js`
- Create: `packages/shared-runtime/project-hash.d.ts`

**Step 1: Write the contract test**

Create `packages/core/tests/shared-runtime/project-hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectHash } from '@locus/shared-runtime';

describe('projectHash (shared-runtime)', () => {
  it('returns 16 hex chars', () => {
    expect(projectHash('/tmp/test-project')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    expect(projectHash('/tmp/my-project')).toBe(projectHash('/tmp/my-project'));
  });

  it('differs for different paths', () => {
    expect(projectHash('/tmp/project-a')).not.toBe(projectHash('/tmp/project-b'));
  });

  it('normalizes backslashes (cross-platform)', () => {
    expect(projectHash('C:/Users/test/project')).toBe(
      projectHash('C:\\Users\\test\\project'),
    );
  });

  it('normalizes case (Windows paths)', () => {
    expect(projectHash('C:/Users/Test/Project')).toBe(
      projectHash('c:/users/test/project'),
    );
  });

  it('matches core utils.projectHash output', async () => {
    const { projectHash: coreHash } = await import('@/utils.js');
    const testPath = '/tmp/consistency-check';
    expect(projectHash(testPath)).toBe(coreHash(testPath));
  });
});
```

**Step 2: Run test — verify it fails**

Run: `npx vitest run packages/core/tests/shared-runtime/project-hash.test.ts`
Expected: FAIL — module not found

**Step 3: Implement project-hash.js**

```js
import { createHash } from 'node:crypto';
import { normalize } from 'node:path';

/**
 * Computes a stable 16-char hex hash of a project root path.
 * Normalizes: backslashes -> forward slashes, lowercased.
 * @param {string} projectRoot
 * @returns {string}
 */
export function projectHash(projectRoot) {
  const normalized = normalize(projectRoot).replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
```

Create `packages/shared-runtime/project-hash.d.ts`:

```ts
export function projectHash(projectRoot: string): string;
```

**Step 4: Run test — verify it passes**

Run: `npx vitest run packages/core/tests/shared-runtime/project-hash.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add packages/shared-runtime/project-hash.js packages/shared-runtime/project-hash.d.ts packages/core/tests/shared-runtime/
git commit -m "feat(shared-runtime): add projectHash — single source of truth for path hashing"
```

---

## Task 3: Implement `detect-client.js`

**Files:**
- Create: `packages/shared-runtime/detect-client.js`
- Create: `packages/shared-runtime/detect-client.d.ts`

**Step 1: Write the contract test**

Create `packages/core/tests/shared-runtime/detect-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectClientEnv } from '@locus/shared-runtime';

describe('detectClientEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns "codex" when CODEX_HOME is set', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(detectClientEnv()).toBe('codex');
  });

  it('returns "claude-code" when CLAUDE_PLUGIN_ROOT is set', () => {
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(detectClientEnv()).toBe('claude-code');
  });

  it('returns "generic" when no client env vars are set', () => {
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(detectClientEnv()).toBe('generic');
  });

  it('CODEX_HOME takes priority over CLAUDE_PLUGIN_ROOT', () => {
    process.env.CODEX_HOME = '/home/user/.codex';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin/path';
    expect(detectClientEnv()).toBe('codex');
  });

  it('ignores empty string env vars', () => {
    process.env.CODEX_HOME = '';
    process.env.CLAUDE_PLUGIN_ROOT = '';
    expect(detectClientEnv()).toBe('generic');
  });
});
```

**Step 2: Run test — verify it fails**

Run: `npx vitest run packages/core/tests/shared-runtime/detect-client.test.ts`
Expected: FAIL

**Step 3: Implement detect-client.js**

```js
/**
 * Detects which AI coding client launched the MCP server.
 * @returns {'claude-code' | 'codex' | 'generic'}
 */
export function detectClientEnv() {
  if (process.env.CODEX_HOME) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'generic';
}
```

Create `packages/shared-runtime/detect-client.d.ts`:

```ts
export type ClientEnv = 'claude-code' | 'codex' | 'generic';
export function detectClientEnv(): ClientEnv;
```

**Step 4: Run test — verify it passes**

Run: `npx vitest run packages/core/tests/shared-runtime/detect-client.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add packages/shared-runtime/detect-client.*
git commit -m "feat(shared-runtime): add detectClientEnv — Claude Code / Codex / generic detection"
```

---

## Task 4: Implement `resolve-storage.js`

**Files:**
- Create: `packages/shared-runtime/resolve-storage.js`
- Create: `packages/shared-runtime/resolve-storage.d.ts`

**Step 1: Write the contract tests**

Create `packages/core/tests/shared-runtime/resolve-storage.test.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
} from '@locus/shared-runtime';

// Helper: save and restore env
const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

// ─── resolveStorageRoot ──────────────────────────────────────────────────────

describe('resolveStorageRoot', () => {
  it('uses LOCUS_STORAGE_ROOT when set (highest priority)', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('LOCUS_STORAGE_ROOT beats CODEX_HOME', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    process.env.CODEX_HOME = '/home/user/.codex';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('LOCUS_STORAGE_ROOT beats CLAUDE_PLUGIN_ROOT', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom/storage';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe('/custom/storage');
  });

  it('uses CODEX_HOME/memory when CODEX_HOME is set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveStorageRoot()).toBe(join('/home/user/.codex', 'memory'));
  });

  it('uses ~/.claude/memory when CLAUDE_PLUGIN_ROOT is set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe(join(homedir(), '.claude', 'memory'));
  });

  it('falls back to ~/.locus/memory when no env vars set', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });

  it('ignores empty string env vars', () => {
    process.env.LOCUS_STORAGE_ROOT = '';
    process.env.CODEX_HOME = '';
    process.env.CLAUDE_PLUGIN_ROOT = '';
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });
});

// ─── resolveProjectStorageDir ────────────────────────────────────────────────

describe('resolveProjectStorageDir', () => {
  it('returns storageRoot/locus-<hash>/', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const dir = resolveProjectStorageDir('/tmp/my-project');
    expect(dir).toMatch(/locus-[a-f0-9]{16}$/);
    expect(dir.startsWith(join(homedir(), '.locus', 'memory'))).toBe(true);
  });

  it('uses LOCUS_STORAGE_ROOT as base', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom';
    const dir = resolveProjectStorageDir('/tmp/my-project');
    expect(dir.startsWith('/custom/locus-')).toBe(true);
  });
});

// ─── resolveDbPath ───────────────────────────────────────────────────────────

describe('resolveDbPath', () => {
  it('returns projectStorageDir/locus.db', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const dbPath = resolveDbPath('/tmp/my-project');
    expect(dbPath).toMatch(/locus-[a-f0-9]{16}[/\\]locus\.db$/);
  });
});

// ─── resolveInboxDir ─────────────────────────────────────────────────────────

describe('resolveInboxDir', () => {
  it('returns projectStorageDir/inbox/', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const inboxDir = resolveInboxDir('/tmp/my-project');
    expect(inboxDir).toMatch(/locus-[a-f0-9]{16}[/\\]inbox$/);
  });
});

// ─── resolveLogPath ──────────────────────────────────────────────────────────

describe('resolveLogPath', () => {
  it('returns storageRoot/locus.log', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(resolveLogPath()).toBe(join(homedir(), '.locus', 'memory', 'locus.log'));
  });

  it('respects LOCUS_STORAGE_ROOT', () => {
    process.env.LOCUS_STORAGE_ROOT = '/custom';
    expect(resolveLogPath()).toBe(join('/custom', 'locus.log'));
  });

  it('respects CLAUDE_PLUGIN_ROOT for backward compat', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveLogPath()).toBe(join(homedir(), '.claude', 'memory', 'locus.log'));
  });
});

// ─── Backward compatibility: Claude Code paths ──────────────────────────────

describe('backward compatibility — Claude Code paths', () => {
  it('Claude Code DB path matches legacy hardcoded path', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';

    const { projectHash } = await import('@locus/shared-runtime');
    const root = '/tmp/my-project';
    const hash = projectHash(root);
    const expected = join(homedir(), '.claude', 'memory', `locus-${hash}`, 'locus.db');
    expect(resolveDbPath(root)).toBe(expected);
  });

  it('Claude Code inbox path matches legacy hardcoded path', () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';

    const { projectHash } = await import('@locus/shared-runtime');
    const root = '/tmp/my-project';
    const hash = projectHash(root);
    const expected = join(homedir(), '.claude', 'memory', `locus-${hash}`, 'inbox');
    expect(resolveInboxDir(root)).toBe(expected);
  });
});
```

**Step 2: Run test — verify it fails**

Run: `npx vitest run packages/core/tests/shared-runtime/resolve-storage.test.ts`
Expected: FAIL

**Step 3: Implement resolve-storage.js**

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { projectHash } from './project-hash.js';
import { detectClientEnv } from './detect-client.js';

/**
 * Resolves the base storage directory for Locus databases.
 * Priority: LOCUS_STORAGE_ROOT > CODEX_HOME/memory > ~/.claude/memory > ~/.locus/memory
 * @returns {string}
 */
export function resolveStorageRoot() {
  if (process.env.LOCUS_STORAGE_ROOT) {
    return process.env.LOCUS_STORAGE_ROOT;
  }

  const client = detectClientEnv();
  const home = homedir();

  if (client === 'codex') {
    return join(process.env.CODEX_HOME, 'memory');
  }

  if (client === 'claude-code') {
    return join(home, '.claude', 'memory');
  }

  // Generic fallback — client-agnostic
  return join(home, '.locus', 'memory');
}

/**
 * Resolves the per-project storage directory.
 * @param {string} projectRoot — absolute path to project root
 * @returns {string} e.g. ~/.claude/memory/locus-a1b2c3d4e5f6g7h8/
 */
export function resolveProjectStorageDir(projectRoot) {
  return join(resolveStorageRoot(), `locus-${projectHash(projectRoot)}`);
}

/**
 * Resolves the SQLite database file path for a project.
 * @param {string} projectRoot
 * @returns {string} e.g. ~/.claude/memory/locus-<hash>/locus.db
 */
export function resolveDbPath(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), 'locus.db');
}

/**
 * Resolves the inbox directory for a project (sibling to DB file).
 * @param {string} projectRoot
 * @returns {string} e.g. ~/.claude/memory/locus-<hash>/inbox/
 */
export function resolveInboxDir(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), 'inbox');
}

/**
 * Resolves the log file path (at storage root level).
 * @returns {string} e.g. ~/.claude/memory/locus.log
 */
export function resolveLogPath() {
  return join(resolveStorageRoot(), 'locus.log');
}
```

Create `packages/shared-runtime/resolve-storage.d.ts`:

```ts
export function resolveStorageRoot(): string;
export function resolveProjectStorageDir(projectRoot: string): string;
export function resolveDbPath(projectRoot: string): string;
export function resolveInboxDir(projectRoot: string): string;
export function resolveLogPath(): string;
```

**Step 4: Run test — verify it passes**

Run: `npx vitest run packages/core/tests/shared-runtime/resolve-storage.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add packages/shared-runtime/resolve-storage.* packages/core/tests/shared-runtime/resolve-storage.test.ts
git commit -m "feat(shared-runtime): add resolve-storage — client-aware path resolution with priority chain"
```

---

## Task 5: Wire up `index.js` barrel + run full shared-runtime test suite

**Files:**
- Modify: `packages/shared-runtime/index.js` (already created in Task 1 with correct exports)
- Modify: `packages/shared-runtime/index.d.ts` (already created in Task 1)

**Step 1: Finalize index.d.ts**

Update `packages/shared-runtime/index.d.ts` to re-export from submodules:

```ts
export type { ClientEnv } from './detect-client.js';
export { detectClientEnv } from './detect-client.js';
export {
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
} from './resolve-storage.js';
export { projectHash } from './project-hash.js';
```

**Step 2: Run full shared-runtime test suite**

Run: `npx vitest run packages/core/tests/shared-runtime/`
Expected: ALL PASS

**Step 3: Run the full existing test suite to confirm no regressions**

Run: `npx vitest run`
Expected: 819 tests passing (no regressions)

**Step 4: Commit**

```bash
git add packages/shared-runtime/index.*
git commit -m "feat(shared-runtime): wire barrel exports — package ready for consumption"
```

---

## Task 6: Switch `@locus/core` to use `@locus/shared-runtime`

**Files:**
- Modify: `packages/core/package.json` — add `@locus/shared-runtime` dependency
- Modify: `packages/core/src/server.ts:64-67` — replace hardcoded paths with resolver calls
- Modify: `packages/core/src/utils.ts` — remove `projectHash`, re-export from shared-runtime

**Step 1: Add workspace dependency**

In `packages/core/package.json`, add to `dependencies`:

```json
"@locus/shared-runtime": "*"
```

Run: `npm install`

**Step 2: Replace hardcoded paths in server.ts (lines 64-67)**

Before:
```ts
const dbPath =
  options?.dbPath ??
  join(homedir(), '.claude', 'memory', `locus-${projectHash(root)}`, 'locus.db');
const logPath = join(homedir(), '.claude', 'memory', 'locus.log');
```

After:
```ts
import { resolveDbPath, resolveInboxDir, resolveLogPath } from '@locus/shared-runtime';

// ...inside createServer():
const dbPath = options?.dbPath ?? resolveDbPath(root);
const logPath = resolveLogPath();
```

Also remove the now-unused `homedir` import from `node:os` (if no other usage in server.ts) and the `projectHash` import from `./utils.js`.

**Step 3: Update utils.ts — re-export projectHash from shared-runtime**

Replace `packages/core/src/utils.ts`:

```ts
// Re-export from shared-runtime (single source of truth)
export { projectHash } from '@locus/shared-runtime';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sanitizeFtsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
}
```

**Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: All 819+ tests pass. The `projectHash` cross-check test from Task 2 now validates consistency.

**Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/server.ts packages/core/src/utils.ts
git commit -m "refactor(core): use @locus/shared-runtime for path resolution — remove hardcoded ~/.claude/ paths"
```

---

## Task 7: Switch `@locus/claude-code` hooks to use `@locus/shared-runtime`

**Files:**
- Modify: `packages/claude-code/package.json` — add `@locus/shared-runtime` dependency
- Modify: `packages/claude-code/hooks/shared.js` — replace `computeProjectHash`, `computeInboxDir`, `computeLocusDir` with shared-runtime imports

**Step 1: Add workspace dependency**

In `packages/claude-code/package.json`, add:

```json
"dependencies": {
  "@locus/shared-runtime": "*"
}
```

Run: `npm install`

**Step 2: Replace path functions in shared.js**

Remove these functions from `shared.js`:
- `computeProjectHash()` (lines 60-63) — replaced by `projectHash` from shared-runtime
- `computeInboxDir()` (lines 113-116) — replaced by `resolveInboxDir` from shared-runtime
- `computeLocusDir()` (lines 124-127) — replaced by `resolveProjectStorageDir` from shared-runtime

Add import at top of `shared.js`:

```js
import { projectHash, resolveInboxDir, resolveProjectStorageDir } from '@locus/shared-runtime';
```

Keep these functions as thin re-exports for backward compatibility with hooks that call them:

```js
// Backward-compatible aliases (hooks import these by name)
export { projectHash as computeProjectHash } from '@locus/shared-runtime';
export { resolveInboxDir as computeInboxDir } from '@locus/shared-runtime';
export { resolveProjectStorageDir as computeLocusDir } from '@locus/shared-runtime';
```

Keep these functions **unchanged** in shared.js (they do NOT duplicate path logic):
- `resolveProjectRoot()` — hook-specific (uses `execFileSync`, no DI)
- `writeAtomicInboxEvent()` — inbox writer (writes to whatever path is given)
- `generateEventId()` — UUID generator
- `computeSourceEventId()` — deterministic dedup hash

**Step 3: Update hook files that call computeInboxDir directly**

Check `post-tool-use.js`, `user-prompt.js`, `stop.js` — they all call `computeInboxDir(projectRoot)` imported from `shared.js`. Since we're keeping the alias export in `shared.js`, these files need **no changes**.

**Step 4: Run hook tests**

Run: `npx vitest run packages/core/tests/hooks/`
Expected: ALL PASS (shared.test.ts, hook-subprocess.test.ts, etc.)

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/claude-code/package.json packages/claude-code/hooks/shared.js
git commit -m "refactor(claude-code): use @locus/shared-runtime for path resolution — single source of truth"
```

---

## Task 8: Update hook-subprocess.test.ts to use shared-runtime

**Files:**
- Modify: `packages/core/tests/hooks/hook-subprocess.test.ts:35-43` — remove duplicated hash+path logic

**Step 1: Replace inline hash/path functions with shared-runtime imports**

Before (lines 31-43):
```ts
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { normalize } from 'node:path';

function computeProjectHash(projectRoot: string): string { ... }
function computeInboxDir(projectRoot: string): string { ... }
```

After:
```ts
import { projectHash, resolveInboxDir } from '@locus/shared-runtime';
```

Also update any usage of `computeProjectHash` to `projectHash` and `computeInboxDir` to `resolveInboxDir` within this test file.

**Step 2: Run hook subprocess tests**

Run: `npx vitest run packages/core/tests/hooks/hook-subprocess.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/core/tests/hooks/hook-subprocess.test.ts
git commit -m "test: use @locus/shared-runtime in hook subprocess tests — remove duplicated path logic"
```

---

## Task 9: Create `packages/codex/` skeleton

**Files:**
- Create: `packages/codex/package.json`
- Create: `packages/codex/README.md`
- Create: `packages/codex/skills/locus-memory/SKILL.md`
- Create: `packages/codex/config/config.toml.example`

**Step 1: Create package.json**

```json
{
  "name": "@locus/codex",
  "version": "3.1.0",
  "private": true,
  "type": "module",
  "description": "Codex CLI adapter for Locus memory — skill definitions and config examples",
  "engines": {
    "node": ">=22.0.0"
  },
  "dependencies": {
    "@locus/shared-runtime": "*"
  }
}
```

**Step 2: Create SKILL.md**

Create `packages/codex/skills/locus-memory/SKILL.md`:

```yaml
---
name: locus-memory
description: >
  Use when the user needs persistent project memory across sessions.
  Triggers on: "remember this", "what did we decide about...",
  "show project structure", "what changed recently", "search memory".
  Do NOT trigger for: ephemeral questions, one-off lookups,
  file reads that don't need memory.
---

# Locus -- Persistent Project Memory

You have access to Locus memory tools via MCP. Use them to maintain
project context across sessions.

## Core Tools

1. **memory_search** -- FTS5 search across all memory layers
2. **memory_remember** -- Save architecture decisions with auto-redaction
3. **memory_explore** -- Navigate the project file tree
4. **memory_timeline** -- View recent conversation history
5. **memory_status** -- Memory health and storage info
6. **memory_scan** -- Re-index project structure after file changes

## Key Behaviors

- Always search memory before re-asking questions the user already answered
- Save important decisions when the user makes architecture choices
- Use `memory_scan` after significant file structure changes
- Prefer `memory_search` over re-reading files when looking for past context
- After completing a major task, call `memory_remember` with a summary
```

**Step 3: Create config.toml.example**

Create `packages/codex/config/config.toml.example`:

```toml
# Locus Memory -- MCP server configuration for Codex CLI
# Copy this block into ~/.codex/config.toml

# Option A: Direct path (after git clone)
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
CODEX_HOME = "~/.codex"

# Option B: npx (after npm publish -- coming soon)
# [mcp_servers.locus]
# command = "npx"
# args = ["-y", "@locus-memory/mcp-server"]
#
# [mcp_servers.locus.env]
# LOCUS_LOG = "error"

# Option C: Windows (use npx.cmd instead of npx)
# [mcp_servers.locus]
# command = "npx.cmd"
# args = ["-y", "@locus-memory/mcp-server"]
```

**Step 4: Create README.md**

Create `packages/codex/README.md`:

```markdown
# @locus/codex

Codex CLI adapter for [Locus](https://github.com/Magnifico4625/locus) persistent memory.

## Quick Start

### 1. Add MCP Server

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or edit `~/.codex/config.toml` directly (see `config/config.toml.example`).

### 2. Install Skill (optional)

Copy `skills/locus-memory/` to `~/.agents/skills/locus-memory/`.

### 3. Verify

```bash
codex "Search memory for recent decisions"
```

## What Works

- All 12 MCP tools (memory_search, memory_remember, memory_explore, etc.)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`

## What's Coming

- Session JSONL adapter for passive conversation capture
- npm package for `npx` one-liner install
```

**Step 5: Run npm install to verify workspace**

Run: `npm install`
Expected: `@locus/codex` appears in workspace list

**Step 6: Commit**

```bash
git add packages/codex/
git commit -m "feat(codex): add skeleton package — Codex CLI skill + config examples"
```

---

## Task 10: Rebuild dist/server.js with new resolver

**Files:**
- Modify: `dist/server.js` (rebuilt from source)

**Step 1: Rebuild**

Run: `npm run build`
Expected: Build succeeds, `dist/server.js` contains `resolveStorageRoot` / `resolveDbPath` / `resolveLogPath` instead of hardcoded `'.claude', 'memory'`.

**Step 2: Verify the built file no longer hardcodes ~/.claude/memory**

Run: `grep -c "'.claude', 'memory'" dist/server.js`
Expected: 0 matches (the path is now computed by the resolver, not hardcoded)

**Step 3: Verify the resolver is bundled in**

Run: `grep -c "resolveStorageRoot\|resolveDbPath\|detectClientEnv" dist/server.js`
Expected: Multiple matches (esbuild inlines the shared-runtime code)

**Step 4: Commit**

```bash
git add dist/
git commit -m "build: rebuild dist/ with client-aware path resolution"
```

---

## Task 11: Regression tests — Claude Code and Codex path behavior

**Files:**
- Create: `packages/core/tests/shared-runtime/regression-paths.test.ts`

**Step 1: Write regression tests**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectClientEnv,
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
  projectHash,
} from '@locus/shared-runtime';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('regression: Claude Code backward compatibility', () => {
  const setupClaudeEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    process.env.CLAUDE_PLUGIN_ROOT = '/some/cache/locus';
  };

  it('storage root = ~/.claude/memory', () => {
    setupClaudeEnv();
    expect(resolveStorageRoot()).toBe(join(homedir(), '.claude', 'memory'));
  });

  it('DB path = ~/.claude/memory/locus-<hash>/locus.db', () => {
    setupClaudeEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveDbPath(root)).toBe(
      join(homedir(), '.claude', 'memory', `locus-${hash}`, 'locus.db'),
    );
  });

  it('inbox = ~/.claude/memory/locus-<hash>/inbox', () => {
    setupClaudeEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveInboxDir(root)).toBe(
      join(homedir(), '.claude', 'memory', `locus-${hash}`, 'inbox'),
    );
  });

  it('log = ~/.claude/memory/locus.log', () => {
    setupClaudeEnv();
    expect(resolveLogPath()).toBe(join(homedir(), '.claude', 'memory', 'locus.log'));
  });
});

describe('regression: Codex CLI paths', () => {
  const setupCodexEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    process.env.CODEX_HOME = '/home/user/.codex';
    delete process.env.CLAUDE_PLUGIN_ROOT;
  };

  it('storage root = $CODEX_HOME/memory', () => {
    setupCodexEnv();
    expect(resolveStorageRoot()).toBe(join('/home/user/.codex', 'memory'));
  });

  it('DB path = $CODEX_HOME/memory/locus-<hash>/locus.db', () => {
    setupCodexEnv();
    const root = '/home/user/my-project';
    const hash = projectHash(root);
    expect(resolveDbPath(root)).toBe(
      join('/home/user/.codex', 'memory', `locus-${hash}`, 'locus.db'),
    );
  });
});

describe('regression: explicit override beats everything', () => {
  it('LOCUS_STORAGE_ROOT overrides all detection', () => {
    process.env.LOCUS_STORAGE_ROOT = '/mnt/shared/locus-data';
    process.env.CODEX_HOME = '/home/user/.codex';
    process.env.CLAUDE_PLUGIN_ROOT = '/some/plugin';
    expect(resolveStorageRoot()).toBe('/mnt/shared/locus-data');
  });
});

describe('regression: generic fallback', () => {
  const setupGenericEnv = () => {
    delete process.env.LOCUS_STORAGE_ROOT;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;
  };

  it('storage root = ~/.locus/memory', () => {
    setupGenericEnv();
    expect(resolveStorageRoot()).toBe(join(homedir(), '.locus', 'memory'));
  });

  it('detects as generic client', () => {
    setupGenericEnv();
    expect(detectClientEnv()).toBe('generic');
  });
});

describe('regression: Windows path normalization', () => {
  it('project hash is identical for forward and backslash paths', () => {
    expect(projectHash('C:\\Users\\Admin\\my-project')).toBe(
      projectHash('C:/Users/Admin/my-project'),
    );
  });
});
```

**Step 2: Run regression tests**

Run: `npx vitest run packages/core/tests/shared-runtime/regression-paths.test.ts`
Expected: ALL PASS

**Step 3: Run full test suite — final regression gate**

Run: `npx vitest run`
Expected: All tests pass (819 existing + ~30 new shared-runtime tests)

**Step 4: Commit**

```bash
git add packages/core/tests/shared-runtime/regression-paths.test.ts
git commit -m "test: add regression tests for Claude Code / Codex / generic path resolution"
```

---

## Task 12: Update vitest config to include shared-runtime tests

**Files:**
- Modify: `vitest.config.ts` — ensure shared-runtime tests are discovered

**Step 1: Check if tests are already discovered**

The current vitest config includes `packages/core/tests/**/*.test.ts`. Since we put shared-runtime tests at `packages/core/tests/shared-runtime/*.test.ts`, they are **already within the glob pattern**. Verify:

Run: `npx vitest run --reporter=verbose 2>&1 | grep shared-runtime`
Expected: Lines showing shared-runtime test files running

If the tests are already discovered, no config change needed — skip to Step 3.

**Step 2: (Only if needed) Update vitest.config.ts include pattern**

Add to the `include` array if tests aren't discovered:
```ts
include: ['packages/core/tests/**/*.test.ts', 'packages/shared-runtime/tests/**/*.test.ts'],
```

**Step 3: Commit (only if config was changed)**

```bash
git add vitest.config.ts
git commit -m "config: include shared-runtime tests in vitest"
```

---

## Task 13: Final — update docs and codexlocus.md

**Files:**
- Modify: `codexlocus.md` — update Section 6 with implemented resolver, mark Phase 1 tasks as done
- Modify: `README.md` — add Codex CLI to Quick Start section

**Step 1: Update codexlocus.md Section 6**

Replace the "Proposed Solution" code block in Section 6 (lines 355-377) with the actual implementation reference:

```markdown
### Implemented Solution: `@locus/shared-runtime`

Path resolution is now in `packages/shared-runtime/resolve-storage.js` — a shared plain ESM module
with zero dependencies beyond Node.js stdlib. Both `@locus/core` and `@locus/claude-code` import
from it via npm workspace symlinks.

**API:**
- `detectClientEnv()` -> `'claude-code' | 'codex' | 'generic'`
- `resolveStorageRoot()` -> base storage directory
- `resolveProjectStorageDir(projectRoot)` -> per-project directory
- `resolveDbPath(projectRoot)` -> SQLite DB path
- `resolveInboxDir(projectRoot)` -> inbox directory
- `resolveLogPath()` -> log file path
- `projectHash(projectRoot)` -> 16-char hex hash
```

**Step 2: Update README.md — add Codex CLI Quick Start**

Add after the existing Claude Code quick start section:

```markdown
### Codex CLI

Add Locus as an MCP server:

\`\`\`bash
codex mcp add locus -- node /path/to/locus/dist/server.js
\`\`\`

Or add directly to `~/.codex/config.toml`:

\`\`\`toml
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
\`\`\`
```

**Step 3: Update Phase 1 checklist in codexlocus.md**

Mark completed items with `[x]`:
```
- [x] **Client-aware storage path** — `resolveStorageRoot()` with env detection
- [x] **Codex skill** — `packages/codex/skills/locus-memory/SKILL.md`
- [ ] **README update** — add Codex CLI to Quick Start (do this now)
- [ ] **Compatibility table update** — add Codex CLI column
- [ ] **Test** — verify `dist/server.js` launches via `codex mcp add`
```

**Step 4: Commit**

```bash
git add codexlocus.md README.md
git commit -m "docs: update codexlocus.md with implemented resolver, add Codex CLI to README"
```

---

## Summary

| Task | Description | New Tests |
|------|-------------|-----------|
| 1 | Package scaffold | 0 |
| 2 | `projectHash` | ~6 |
| 3 | `detectClientEnv` | ~5 |
| 4 | `resolveStorage*` (5 functions) | ~12 |
| 5 | Barrel + full suite | 0 |
| 6 | Switch core | 0 (existing 819 = regression) |
| 7 | Switch hooks | 0 (existing hook tests = regression) |
| 8 | Clean up hook-subprocess.test.ts | 0 |
| 9 | Codex skeleton | 0 |
| 10 | Rebuild dist/ | 0 |
| 11 | Regression tests | ~12 |
| 12 | Vitest config (if needed) | 0 |
| 13 | Docs update | 0 |
| **Total** | **13 tasks, ~12 commits** | **~35 new tests** |

**Total estimated new files:** 14 (6 in shared-runtime, 4 in codex, 4 test files)
**Total modified files:** 7 (server.ts, utils.ts, shared.js, hook-subprocess.test.ts, vitest.config.ts, README.md, codexlocus.md)
