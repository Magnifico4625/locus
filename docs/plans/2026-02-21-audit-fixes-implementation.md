# Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 issues found by external audit before testing/publishing Locus v0.1.0.

**Architecture:** Bug fixes and config corrections across packaging, messaging, and scanner modules. No new modules. Single branch with one commit per logical fix.

**Tech Stack:** TypeScript, Vitest, esbuild, npm, git

**Design doc:** `docs/plans/2026-02-21-audit-fixes-design.md`

---

## Pre-flight: Create branch

```bash
git checkout -b fix/audit-fixes
```

---

### Task 1: Untrack settings.local.json and update .gitignore

**Files:**
- Modify: `.gitignore`
- Untrack: `.claude/settings.local.json`

**Step 1: Add .claude/settings.local.json to .gitignore**

In `.gitignore`, add at the end of the "# Environment" section (after line 22):

```
.claude/settings.local.json
```

**Step 2: Untrack the file from git**

```bash
git rm --cached .claude/settings.local.json
```

**Step 3: Verify**

```bash
git status
```

Expected: `.claude/settings.local.json` shows as "deleted" in staging (untracked from git), `.gitignore` shows as modified.

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack settings.local.json, add to .gitignore"
```

---

### Task 2: Add npm "files" whitelist, explicit zod dep, Node 22+ engines

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Step 1: Edit package.json**

Add `"files"` field after `"main"` (line 6):

```json
"files": [
  "dist/",
  "LICENSE",
  "README.md"
],
```

Add `zod` to `dependencies`:

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.26.0",
  "zod": "^3.25 || ^4.0"
},
```

Change `engines`:

```json
"engines": {
  "node": ">=22.0.0"
},
```

**Step 2: Edit CI matrix**

In `.github/workflows/ci.yml` line 16, change:

```yaml
        node-version: [22, 24]
```

**Step 3: Verify typecheck still passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "chore: add npm files whitelist, explicit zod dep, Node 22+ engines"
```

---

### Task 3: Fix purge message and rename deletedDbPath

**Files:**
- Modify: `src/types.ts:235-239`
- Modify: `src/tools/purge.ts:86-90`
- Modify: `tests/tools/purge.test.ts:216-228`
- Modify: `tests/integration/e2e.test.ts:291`

**Step 1: Update the type in src/types.ts**

Change `PurgeResponseDone` (lines 235-239) from:

```typescript
export interface PurgeResponseDone {
  status: 'purged';
  message: string;
  deletedDbPath: string;
}
```

to:

```typescript
export interface PurgeResponseDone {
  status: 'purged';
  message: string;
  clearedDbPath: string;
}
```

**Step 2: Update src/tools/purge.ts**

Change lines 86-90 from:

```typescript
  return {
    status: 'purged',
    message: `Deleted ${deps.dbPath}. Memory cleared.`,
    deletedDbPath: deps.dbPath,
  };
```

to:

```typescript
  return {
    status: 'purged',
    message: `All data cleared. Database file preserved at ${deps.dbPath}.`,
    clearedDbPath: deps.dbPath,
  };
```

**Step 3: Update tests/tools/purge.test.ts**

Change test at line 216 from:

```typescript
  it('PurgeResponseDone includes correct deletedDbPath', () => {
```

to:

```typescript
  it('PurgeResponseDone includes correct clearedDbPath', () => {
```

Change lines 224-226 from:

```typescript
    if (result.status === 'purged') {
      expect(result.deletedDbPath).toBe(dbPath);
      expect(result.message).toContain(dbPath);
    }
```

to:

```typescript
    if (result.status === 'purged') {
      expect(result.clearedDbPath).toBe(dbPath);
      expect(result.message).toContain('preserved');
      expect(result.message).toContain(dbPath);
    }
```

**Step 4: Update tests/integration/e2e.test.ts**

Change line 291 from:

```typescript
    expect(doneTyped.deletedDbPath).toBe(dbPath);
```

to:

```typescript
    expect(doneTyped.clearedDbPath).toBe(dbPath);
```

**Step 5: Run tests**

```bash
npx vitest run tests/tools/purge.test.ts tests/integration/e2e.test.ts
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/types.ts src/tools/purge.ts tests/tools/purge.test.ts tests/integration/e2e.test.ts
git commit -m "fix: purge message accuracy — say 'cleared' not 'deleted'"
```

---

### Task 4: Mark /compact and /memory-config as planned in SKILL.md

**Files:**
- Modify: `skills/memory/SKILL.md`

**Step 1: Edit SKILL.md**

Remove `/compact` and `/memory-config` from the `triggers:` frontmatter (lines 7 and 12). The triggers should become:

```yaml
triggers:
  - /remember
  - /forget
  - /memory-status
  - /memory-doctor
  - /memory-audit
  - /memory-purge
```

Change the `/compact` section (line 24-25) from:

```markdown
## /compact
Manually trigger episodic memory compression.
```

to:

```markdown
## /compact *(planned — not yet implemented)*
Manually trigger episodic memory compression.
```

Change the `/memory-config` section (line 39-40) from:

```markdown
## /memory-config <key> <value>
Change Locus configuration (captureLevel, maskPaths, compressionMode, etc.).
```

to:

```markdown
## /memory-config <key> <value> *(planned — not yet implemented)*
Change Locus configuration (captureLevel, maskPaths, compressionMode, etc.).
```

**Step 2: Commit**

```bash
git add skills/memory/SKILL.md
git commit -m "docs: mark /compact and /memory-config as planned in SKILL.md"
```

---

### Task 5: Scanner writes lastStrategy and lastScanDuration to scan_state

**Files:**
- Modify: `src/scanner/index.ts:589-603`
- Modify: `src/resources/project-map.ts:203`
- Modify: `tests/resources/project-map.test.ts:225`
- Modify: `tests/scanner/scan-project.test.ts` (add new test)

**Step 1: Write the failing test in scan-project.test.ts**

Add after the last `it()` block (before the closing `});` of the describe block):

```typescript
  it('writes lastStrategy and lastScanDuration to scan_state', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const strategyRow = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastStrategy'",
    );
    expect(strategyRow).toBeDefined();
    expect(strategyRow?.value).toBe('full');

    const durationRow = db.get<{ value: string }>(
      "SELECT value FROM scan_state WHERE key = 'lastScanDuration'",
    );
    expect(durationRow).toBeDefined();
    expect(Number(durationRow?.value)).toBeGreaterThanOrEqual(0);
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/scanner/scan-project.test.ts -t "writes lastStrategy"
```

Expected: FAIL — `strategyRow` is undefined.

**Step 3: Implement — add two setScanState calls in src/scanner/index.ts**

After line 601 (after the git HEAD block), before `const durationMs = Date.now() - startTime;`, add:

```typescript
  const durationMs = Date.now() - startTime;

  // Write strategy and duration to scan_state
  setScanState(db, 'lastStrategy', strategy.type);
  setScanState(db, 'lastScanDuration', String(durationMs));
```

And remove the duplicate `const durationMs = Date.now() - startTime;` that was on line 603.

The result should be (lines 589-611):

```typescript
  // Update scan_state
  setScanState(db, 'lastScan', String(now));
  if (strategy.type === 'full') {
    setScanState(db, 'lastFullRescan', String(now));
  }

  // Update git HEAD if available
  if (deps.isGitRepo(projectPath)) {
    const head = deps.getHead(projectPath);
    if (head) {
      setScanState(db, 'lastHead', head);
    }
  }

  const durationMs = Date.now() - startTime;

  // Write strategy and duration to scan_state
  setScanState(db, 'lastStrategy', strategy.type);
  setScanState(db, 'lastScanDuration', String(durationMs));

  const stats: ScanStats = {
```

**Step 4: Fix project-map.ts key name**

In `src/resources/project-map.ts` line 203, change:

```typescript
  const lastScanStrategy = scanState.get('lastScanStrategy') ?? 'unknown';
```

to:

```typescript
  const lastScanStrategy = scanState.get('lastStrategy') ?? 'unknown';
```

**Step 5: Fix project-map test key name**

In `tests/resources/project-map.test.ts` line 225, change:

```typescript
    setScanState(adapter, 'lastScanStrategy', 'git-diff');
```

to:

```typescript
    setScanState(adapter, 'lastStrategy', 'git-diff');
```

**Step 6: Run all related tests**

```bash
npx vitest run tests/scanner/scan-project.test.ts tests/resources/project-map.test.ts tests/tools/status.test.ts
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/scanner/index.ts src/resources/project-map.ts tests/scanner/scan-project.test.ts tests/resources/project-map.test.ts
git commit -m "fix: scanner writes lastStrategy and lastScanDuration to scan_state"
```

---

### Task 6: Enforce maxScanFiles limit in scanner

**Files:**
- Modify: `src/scanner/index.ts` (scan loop, lines 440-587)
- Modify: `tests/scanner/scan-project.test.ts` (add new test)

**Step 1: Write the failing test**

Add to `tests/scanner/scan-project.test.ts`:

```typescript
  it('stops scanning after reaching maxScanFiles limit', async () => {
    const config = { ...LOCUS_DEFAULTS, maxScanFiles: 1 };
    const result = await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    // Only 1 file should be scanned (maxScanFiles=1)
    expect(result.stats.scannedFiles).toBe(1);
    // Remaining scannable files should count as skipped
    expect(result.stats.skippedFiles).toBeGreaterThanOrEqual(1);
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/scanner/scan-project.test.ts -t "stops scanning after reaching"
```

Expected: FAIL — scannedFiles will be 3 (no limit applied).

**Step 3: Implement the limit**

In `src/scanner/index.ts`, add at the very start of the `for` loop body (line 441, before the `shouldIgnore` check):

```typescript
    // maxScanFiles limit
    if (scannedEntries.length >= config.maxScanFiles) {
      skippedFiles++;
      continue;
    }
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run tests/scanner/scan-project.test.ts -t "stops scanning after reaching"
```

Expected: PASS.

**Step 5: Run full scanner test suite**

```bash
npx vitest run tests/scanner/scan-project.test.ts
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/scanner/index.ts tests/scanner/scan-project.test.ts
git commit -m "feat: enforce maxScanFiles limit in scanner"
```

---

### Task 7: Store skipped file entries with reasons

**Files:**
- Modify: `src/scanner/index.ts` (scan loop — each skip point)
- Modify: `tests/scanner/scan-project.test.ts` (add new tests)

**Step 1: Write the failing tests**

Add to `tests/scanner/scan-project.test.ts`:

```typescript
  it('stores skipped entries with skippedReason in the database', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    // The fixture has .env (denylisted) and package.json/tsconfig.json (unknown-language)
    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      'SELECT relative_path, skipped_reason FROM files WHERE skipped_reason IS NOT NULL',
    );
    expect(skippedRows.length).toBeGreaterThanOrEqual(1);

    // .env should be denylisted
    const envRow = skippedRows.find((r) => r.relative_path === '.env');
    expect(envRow).toBeDefined();
    expect(envRow?.skipped_reason).toBe('denylisted');
  });

  it('stores unknown-language skip reason for non-code files', async () => {
    const config = { ...LOCUS_DEFAULTS };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      'SELECT relative_path, skipped_reason FROM files WHERE skipped_reason IS NOT NULL',
    );

    // package.json has no known language
    const pkgRow = skippedRows.find((r) => r.relative_path === 'package.json');
    expect(pkgRow).toBeDefined();
    expect(pkgRow?.skipped_reason).toBe('unknown-language');
  });

  it('stores max-files-reached skip reason when limit hit', async () => {
    const config = { ...LOCUS_DEFAULTS, maxScanFiles: 1 };
    await scanProject(FIXTURE_PATH, db, config, fullScanDeps());

    const skippedRows = db.all<{ relative_path: string; skipped_reason: string }>(
      "SELECT relative_path, skipped_reason FROM files WHERE skipped_reason = 'max-files-reached'",
    );
    expect(skippedRows.length).toBeGreaterThanOrEqual(1);
  });
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/scanner/scan-project.test.ts -t "stores skipped"
npx vitest run tests/scanner/scan-project.test.ts -t "stores unknown-language"
npx vitest run tests/scanner/scan-project.test.ts -t "stores max-files-reached"
```

Expected: all FAIL — no skipped entries are stored in DB currently.

**Step 3: Implement — add helper function and replace skip points**

Add a helper function in `src/scanner/index.ts` before `scanProject` (e.g. after `storeFileEntry`, around line 378):

```typescript
function storeSkippedEntry(
  db: DatabaseAdapter,
  relPath: string,
  reason: string,
  now: number,
): void {
  db.run(
    `INSERT OR REPLACE INTO files (
      relative_path, exports_json, imports_json, re_exports_json,
      file_type, language, lines,
      confidence_level, confidence_reason,
      last_scanned, skipped_reason
    ) VALUES (?, '[]', '[]', '[]', 'module', 'typescript', 0, 'high', NULL, ?, ?)`,
    [relPath, now, reason],
  );
}
```

Then replace each skip point in the scan loop. The loop (lines 440-587) should become:

```typescript
  for (const relPath of filePaths) {
    // maxScanFiles limit
    if (scannedEntries.length >= config.maxScanFiles) {
      storeSkippedEntry(db, relPath, 'max-files-reached', now);
      skippedFiles++;
      continue;
    }

    // Ignore check
    if (shouldIgnore(relPath)) {
      storeSkippedEntry(db, relPath, 'ignored', now);
      skippedFiles++;
      continue;
    }

    // Security denylist check
    if (isDenylisted(relPath)) {
      storeSkippedEntry(db, relPath, 'denylisted', now);
      skippedFiles++;
      continue;
    }

    // Language detection
    const language = detectLanguage(relPath);
    if (language === null) {
      storeSkippedEntry(db, relPath, 'unknown-language', now);
      skippedFiles++;
      continue;
    }

    // File size check
    const fullPath = join(projectPath, relPath);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      storeSkippedEntry(db, relPath, 'stat-failed', now);
      skippedFiles++;
      continue;
    }

    if (stat.size > config.maxFileSize) {
      storeSkippedEntry(db, relPath, 'too-large', now);
      skippedFiles++;
      continue;
    }

    // Read file
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      storeSkippedEntry(db, relPath, 'read-failed', now);
      skippedFiles++;
      continue;
    }

    // Binary check
    if (isBinary(content)) {
      storeSkippedEntry(db, relPath, 'binary', now);
      skippedFiles++;
      continue;
    }

    // ... rest of parsing unchanged ...
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/scanner/scan-project.test.ts
```

Expected: all pass (old + new tests).

**Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 6: Run full test suite**

```bash
npm test
```

Expected: all 480+ tests pass.

**Step 7: Commit**

```bash
git add src/scanner/index.ts tests/scanner/scan-project.test.ts
git commit -m "feat: store skipped file entries with reasons in scanner"
```

---

### Task 8: Final verification and lint

**Step 1: Run full check**

```bash
npm run check
```

This runs `typecheck && lint && test`. Expected: all pass.

**Step 2: Run build**

```bash
npm run build
```

Expected: `dist/server.js` generated successfully.

**Step 3: Verify npm pack is clean**

```bash
npm pack --dry-run
```

Expected: only `dist/`, `package.json`, `LICENSE` (if exists), `README.md` (if exists). No `tests/`, no `.claude/settings.local.json`.

---

## Summary

| Task | What | Files modified |
|------|------|---------------|
| 1 | Untrack settings.local.json | `.gitignore` |
| 2 | npm files + zod + Node 22+ | `package.json`, `ci.yml` |
| 3 | Fix purge message + rename field | `types.ts`, `purge.ts`, 2 test files |
| 4 | SKILL.md planned commands | `SKILL.md` |
| 5 | Scanner writes scan state keys | `scanner/index.ts`, `project-map.ts`, 2 test files |
| 6 | Enforce maxScanFiles | `scanner/index.ts`, 1 test file |
| 7 | Store skipped entries with reasons | `scanner/index.ts`, 1 test file |
| 8 | Final verification | none (verify only) |

**Total: 7 commits, ~10 files modified, ~4 new tests added.**
