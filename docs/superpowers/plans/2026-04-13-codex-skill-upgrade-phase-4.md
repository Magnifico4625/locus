# Codex Skill Upgrade Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Codex-facing Locus skill so Codex CLI uses memory tools predictably, while also providing a reproducible local sync path for the installed skill and honest usage guidance for VS Code and other MCP-based IDEs.

**Architecture:** Phase 4 stays out of `packages/core` and `packages/claude-code`. The canonical behavior lives in `packages/codex/skills/locus-memory/SKILL.md`, a small sync helper copies that canonical skill into the user's local `CODEX_HOME/skills`, and docs explain what is guaranteed in CLI versus what depends on IDE/extension MCP support. The skill should treat Phase 3 auto-import as the default recent-history path, with `memory_import_codex` reserved for manual catch-up and filtered imports.

**Tech Stack:** Node.js 22+, TypeScript, ESM, Vitest, npm workspaces, filesystem copy utilities, Codex skill markdown, MCP config docs.

---

## Scope

In scope:

- upgrade the canonical Codex skill workflow for Phase 3 reality
- add a reproducible local sync/install path for the skill
- document CLI, VS Code Codex extension, and other MCP IDE usage boundaries
- keep `memory_import_codex` as an explicit manual catch-up tool
- add tests that lock the intended skill contract and sync behavior

Out of scope:

- any `packages/core/**` logic changes
- any `packages/claude-code/**` changes
- new Codex doctor checks (Phase 5)
- plugin packaging work (Phase 7)
- promising MCP parity in IDEs that currently depend on upstream preview behavior

## Design Decisions

- The canonical skill source remains `packages/codex/skills/locus-memory/SKILL.md`.
- The skill must assume Phase 3 exists: recent Codex history reaches memory through auto-import before `memory_search`.
- The skill should instruct Codex to use `memory_status` when history does not appear, instead of blindly retrying import.
- `memory_import_codex` stays in the workflow, but only for explicit catch-up, older sessions, or filtered/manual control.
- Local installed skill state must be reproducible from the repo via a sync command, not by undocumented manual copying.
- VS Code Codex extension and similar IDEs should be documented honestly as MCP-dependent surfaces, not as guaranteed equivalents of CLI skill execution.

## File Structure

Create:

- `packages/codex/src/skill-sync.ts`
- `packages/codex/tests/skill-contract.test.ts`
- `packages/codex/tests/skill-sync.test.ts`
- `scripts/sync-codex-skill.mjs`

Modify:

- `package.json`
- `packages/codex/src/index.ts`
- `packages/codex/skills/locus-memory/SKILL.md`
- `packages/codex/README.md`
- `packages/codex/config/config.toml.example`
- `README.md`
- `docs/roadmap/codex.md`

Do not modify:

- `packages/core/**`
- `packages/claude-code/**`
- `dist/**` until final validation

## Public Contract

Phase 4 should make the Codex-facing workflow explicit:

- `memory_search` is the first tool for recalling project history and recent Codex dialogue.
- `memory_status` is the diagnostic tool when recent dialogue is missing.
- `memory_import_codex` is a manual catch-up tool, not the default first step.
- `memory_remember` is the persistence tool for important decisions after task completion.
- `memory_scan` is used after structural project changes.
- `npm run sync:codex-skill` copies the repo skill into the local installed Codex skill directory.

## Compatibility Position

The plan must preserve this wording in docs and skill guidance:

- **Codex CLI:** fully supported target for the skill workflow.
- **Codex VS Code extension:** supported through the same MCP server/config path when the extension surface exposes the same tools, but behavior may depend on upstream extension support and preview state.
- **Other MCP IDEs:** Locus works through MCP tools/resources, but the Codex-specific skill is not the primary integration mechanism.

This avoids making promises the project cannot enforce from inside the repo.

## Risk Controls

- Do not reintroduce “run `memory_import_codex` before every history search” as the default skill instruction.
- Do not write a sync helper that guesses arbitrary unsafe paths; it must resolve `CODEX_HOME` or a documented fallback deterministically.
- Do not let docs imply that a VS Code extension limitation is fixed by the repo if the limitation is upstream.
- Do not let local sync steps mutate repo files or user files silently without an explicit command.
- Keep the skill compact and directive; avoid turning `SKILL.md` into general documentation prose.

### Task 0: Branch From Phase 3 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree on the current branch.

- [ ] Verify Phase 3 checkpoint tag exists:

```bash
git tag --list codex-auto-import-phase-3-local
```

Expected: prints `codex-auto-import-phase-3-local`.

- [ ] Create the Phase 4 branch from the stable checkpoint:

```bash
git checkout codex-auto-import-phase-3-local
git checkout -b feature/codex-skill-upgrade
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `5a70e57 chore(codex): complete phase 3 validation` at or near `HEAD`.

### Task 1: Lock The Skill Contract With Failing Tests

**Files:**
- Create: `packages/codex/tests/skill-contract.test.ts`

- [ ] Add a failing contract test that reads `packages/codex/skills/locus-memory/SKILL.md` and asserts the canonical skill includes:
  - `memory_search` as the default recall tool
  - `memory_status` as the diagnostic path when recent history is missing
  - `memory_import_codex` as a manual catch-up or filtered import tool
  - `memory_remember` after important decisions
  - `memory_scan` after structural file changes
  - an explicit statement that recent Codex history is auto-imported before `memory_search`

- [ ] Add a second failing contract test that ensures the skill does **not** contain obsolete guidance such as “always run `memory_import_codex` before history-related searches”.

- [ ] Run:

```bash
npm test -- packages/codex/tests/skill-contract.test.ts
```

Expected: FAIL because the current skill still reflects pre-Phase-4 guidance.

- [ ] Commit:

```bash
git add packages/codex/tests/skill-contract.test.ts
git commit -m "test(codex): define skill workflow contract"
```

### Task 2: Add A Reproducible Skill Sync Helper

**Files:**
- Create: `packages/codex/src/skill-sync.ts`
- Create: `packages/codex/tests/skill-sync.test.ts`
- Modify: `packages/codex/src/index.ts`
- Create: `scripts/sync-codex-skill.mjs`
- Modify: `package.json`

- [ ] Write failing tests for a sync helper that:
  - resolves the canonical skill source path in the repo
  - resolves the installed Codex skill directory from `CODEX_HOME` or fallback `~/.codex`
  - creates the target directory when missing
  - copies `SKILL.md` into `skills/locus-memory/SKILL.md`
  - returns the source and target paths for logging/debugging

- [ ] Run:

```bash
npm test -- packages/codex/tests/skill-sync.test.ts
```

Expected: FAIL because the sync helper does not exist yet.

- [ ] Implement the minimal helper in `packages/codex/src/skill-sync.ts`:
  - pure path resolver functions
  - one copy function for the canonical skill
  - no repo writes, only explicit user target writes

- [ ] Export the helper from `packages/codex/src/index.ts`.

- [ ] Add `scripts/sync-codex-skill.mjs` as a thin CLI wrapper around the helper.

- [ ] Add a root script:

```json
"sync:codex-skill": "node scripts/sync-codex-skill.mjs"
```

- [ ] Re-run:

```bash
npm test -- packages/codex/tests/skill-sync.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [ ] Commit:

```bash
git add package.json packages/codex/src/index.ts packages/codex/src/skill-sync.ts packages/codex/tests/skill-sync.test.ts scripts/sync-codex-skill.mjs
git commit -m "feat(codex): add skill sync helper"
```

### Task 3: Upgrade The Canonical Codex Skill

**Files:**
- Modify: `packages/codex/skills/locus-memory/SKILL.md`
- Test: `packages/codex/tests/skill-contract.test.ts`

- [ ] Update the canonical skill so it tells Codex to:
  - use `memory_search` before re-asking project questions
  - rely on recent-history auto-import before `memory_search`
  - inspect `memory_status` if recent dialogue is missing or stale
  - use `memory_import_codex` only for older sessions, filtered imports, or explicit catch-up
  - call `memory_remember` after important decisions or major task completion
  - call `memory_scan` after large file-structure changes

- [ ] Keep the skill concise and operational. Prefer imperative guidance over large explanatory paragraphs.

- [ ] Run:

```bash
npm test -- packages/codex/tests/skill-contract.test.ts
```

Expected: PASS.

- [ ] Commit:

```bash
git add packages/codex/skills/locus-memory/SKILL.md packages/codex/tests/skill-contract.test.ts
git commit -m "docs(codex): upgrade locus memory skill workflow"
```

### Task 4: Document CLI, VS Code, And MCP IDE Boundaries

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `packages/codex/config/config.toml.example`

- [ ] Update `README.md`:
  - add or refine a Codex CLI workflow section around Phase 3 + Phase 4 behavior
  - add a short Codex VS Code extension note explaining that it uses Codex MCP configuration when the extension surface exposes MCP tools
  - explain that other MCP IDEs use Locus through MCP, not through the Codex-specific skill

- [ ] Update `packages/codex/README.md`:
  - describe canonical skill behavior after Phase 3
  - document `npm run sync:codex-skill`
  - clarify manual import versus search-time auto-import
  - keep wording honest about VS Code extension / preview dependencies

- [ ] Update `packages/codex/config/config.toml.example`:
  - include the recommended `LOCUS_CODEX_CAPTURE` / `LOCUS_CAPTURE_LEVEL` block
  - add a comment pointing to the local skill sync command

- [ ] Run docs sanity search:

```bash
rg -n "memory_search|memory_status|memory_import_codex|sync:codex-skill|VS Code|MCP" README.md packages/codex/README.md packages/codex/config/config.toml.example
```

- [ ] Commit:

```bash
git add README.md packages/codex/README.md packages/codex/config/config.toml.example
git commit -m "docs(codex): document skill workflow and IDE boundaries"
```

### Task 5: Update Roadmap And Local Install Workflow

**Files:**
- Modify: `docs/roadmap/codex.md`

- [ ] Mark Phase 4 as implemented locally only after tests and docs are green.

- [ ] Record that:
  - canonical skill workflow now matches Phase 3 auto-import semantics
  - local installed skill can be synced from the repo
  - CLI is the primary guaranteed target
  - VS Code / IDE behavior still depends on MCP surface availability

- [ ] Run the local sync command once on the developer machine:

```bash
npm run sync:codex-skill
```

Expected: prints source/target paths and updates the local installed Codex skill.

- [ ] Verify the installed local skill file exists:

```bash
Get-Content "$HOME\\.codex\\skills\\locus-memory\\SKILL.md"
```

Expected: content matches the upgraded canonical skill, unless `CODEX_HOME` overrides the base path.

- [ ] Commit repo-visible changes only:

```bash
git add docs/roadmap/codex.md
git commit -m "docs(codex): mark phase 4 skill upgrade complete"
```

### Task 6: Targeted Validation

**Files:** all modified repo files

- [ ] Run:

```bash
npm test -- packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [ ] Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] Commit any formatting-only follow-up if needed:

```bash
git add <files>
git commit -m "chore(codex): format phase 4 skill changes"
```

### Task 7: Full Validation And Phase 4 Checkpoint

**Files:** all modified repo files

- [ ] Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] Run:

```bash
npm test
```

Expected: PASS.

- [ ] Run:

```bash
npm run build
```

Expected: PASS.

- [ ] Review final branch diff:

```bash
git diff --stat codex-auto-import-phase-3-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-auto-import-phase-3-local..HEAD
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-skill-upgrade-phase-4-local -m "Codex skill upgrade phase 4 local checkpoint"
```

- [ ] Final checkpoint commit if needed:

```bash
git commit -m "chore(codex): complete phase 4 validation"
```

---

## Manual Verification

After automated validation:

1. Start a Codex CLI session that has Locus MCP configured.
2. Ask a question that should trigger recall of recent work.
3. Verify Codex uses `memory_search` first.
4. If history is missing, verify the workflow points toward `memory_status` before manual import.
5. Ask Codex to explicitly catch up older history and verify it uses `memory_import_codex`.

Optional IDE verification:

1. Open the Codex VS Code extension in a workspace that should use the same MCP config.
2. Verify whether Locus MCP tools are visible in that surface.
3. If not visible, confirm the docs describe this as an upstream/preview integration boundary rather than a Locus skill bug.

## Notes For Execution

- If a reviewer suggests adding new `packages/core` behavior in Phase 4, defer that to Phase 5 unless a concrete bug is demonstrated.
- If the local sync command needs to support non-default skill roots later, add that through explicit arguments or env overrides, not through heuristic filesystem scanning.
- If VS Code extension behavior differs from CLI in manual smoke testing, document the limitation; do not “fix” it by promising unsupported behavior in the skill text.
