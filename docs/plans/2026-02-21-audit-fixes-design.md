# Audit Fixes Design — 2026-02-21

Issues discovered by external GPT audit of Locus v0.1.0 MVP.
All verified as valid. This document captures the approved fix design.

## Scope

- **In scope:** 8 bug/config fixes across 5 sections
- **Out of scope:** README.md, LICENSE (deferred to pre-release)

## User Decisions

| Question | Answer |
|----------|--------|
| Min Node version | **22+** — drop Node 20 from CI and engines |
| /compact, /memory-config in SKILL.md | **Keep with "(planned)" label**, remove from triggers |
| README/LICENSE | **Deferred** to pre-release phase |
| maxScanFiles + skipped_reason | **Implement both** |

## Section 1: Packaging & Git Hygiene

### Fix 1.1 — Untrack settings.local.json
- Add `.claude/settings.local.json` to `.gitignore`
- `git rm --cached .claude/settings.local.json`

### Fix 1.2 — npm "files" whitelist
- Add to `package.json`:
  ```json
  "files": ["dist/", "LICENSE", "README.md"]
  ```

### Fix 1.3 — Explicit zod dependency
- Add to `package.json` dependencies:
  ```json
  "zod": "^3.25 || ^4.0"
  ```

### Fix 1.4 — Node 22+ engines and CI matrix
- `package.json`: `"engines": { "node": ">=22.0.0" }`
- `.github/workflows/ci.yml`: `node-version: [22, 24]`

## Section 2: Messaging Fixes

### Fix 2.1 — Purge message accuracy
- **File:** `src/tools/purge.ts`
- Change message from `"Deleted <path>. Memory cleared."` to `"All data cleared. Database file preserved at <path>."`
- Rename `deletedDbPath` → `clearedDbPath` in `PurgeResponseDone` type (`src/types.ts`)
- Update all tests referencing old message/field name

### Fix 2.2 — SKILL.md planned commands
- **File:** `skills/memory/SKILL.md`
- Remove `/compact` and `/memory-config` from `triggers:` frontmatter
- Mark both command descriptions with `*(planned — not yet implemented)*`

## Section 3: Scanner — Scan State Keys

### Fix 3.1 — Write missing scan state keys
- **File:** `src/scanner/index.ts` (after line 603)
- Add: `setScanState(db, 'lastStrategy', strategy.type)`
- Add: `setScanState(db, 'lastScanDuration', String(durationMs))`
- **File:** `src/resources/project-map.ts` (line 203)
- Rename key `lastScanStrategy` → `lastStrategy` to match what scanner writes
- `lastScanDuration` key already matches — no change needed
- **File:** `src/tools/status.ts` — already reads `lastStrategy`, no change needed
- Add tests for new scan state writes

## Section 4: Scanner — maxScanFiles + skipped_reason

### Fix 4.1 — Enforce maxScanFiles limit
- **File:** `src/scanner/index.ts` (in main scan loop)
- Add early break: `if (scannedEntries.length >= config.maxScanFiles) break;`
- Files skipped by limit get reason `'max-files-reached'`
- Add tests

### Fix 4.2 — Store skipped entries with reasons
- **File:** `src/scanner/index.ts` (each skip point in scan loop)
- Instead of just `skippedFiles++; continue;`, create a minimal `FileEntry` with `skippedReason`
- Reason values: `'ignored'`, `'denylisted'`, `'unknown-language'`, `'stat-failed'`, `'too-large'`, `'read-failed'`, `'binary'`, `'max-files-reached'`
- Add tests for each skip reason

## Section 5: Pre-Release (Deferred)

- README.md — full documentation before GitHub release
- LICENSE — MIT license file before npm publish
- Not part of current fix batch

## Fix Order

1. Section 1 (packaging) — independent, no code logic changes
2. Section 2 (messaging) — point edits, no cross-file deps
3. Section 3 (scan state keys) — scanner + readers coordination
4. Section 4 (scanner features) — deepest changes, depends on scanner understanding

## Branch Strategy

Single branch `fix/audit-fixes` from `master`, one commit per fix.
