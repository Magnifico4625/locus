# Track C C5 Optional Codex Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Codex hook support as a freshness/trigger layer without making hooks required for recall correctness.

**Architecture:** Add a small CLI hook command and optional installer flag. Hooks should read Codex hook JSON from stdin, fail open, use short timeouts in generated config, and never write heavy transcript content directly. Pre-query JSONL/transcript import remains canonical.

Hook commands must not open SQLite and must not call the Locus MCP server.
If a hook needs to persist a trigger, it may only perform an atomic file write
through temp-file-then-rename, preferably into an inbox-compatible or dedicated
trigger queue. This avoids `SQLITE_BUSY` and cross-process DB races while the
MCP server is running.

**Tech Stack:** TypeScript, Vitest, `packages/cli`, `packages/codex` plugin packaging helpers, Codex hooks JSON config, no core schema changes.

---

## Release Position

This plan is allowed to slip to `v3.6.x`. Do not block `v3.6.0` core recall quality on hooks.

## Scope

In scope:

- hook command contract
- optional `install codex --with-hooks`
- hook config generation
- doctor hook diagnostics
- plugin hook packaging if stable enough
- fail-open behavior

Out of scope:

- hook-first memory capture
- blocking prompts/tool calls
- PostToolUse broad capture
- direct SQLite writes from hook commands
- MCP tool calls from hook commands
- replacing JSONL/transcript import

## File Structure

Create:

- `packages/cli/src/commands/hook-codex.ts`
- `packages/cli/src/codex/hooks.ts`
- `packages/cli/tests/codex-hooks.test.ts`

Modify:

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/install-codex.ts`
- `packages/cli/src/commands/doctor-codex.ts`
- `packages/cli/tests/codex-install.test.ts`
- `packages/cli/tests/codex-doctor.test.ts`
- `packages/codex/src/plugin-sync.ts`
- `packages/codex/tests/marketplace-bundle.test.ts`
- `plugins/locus-memory/.codex-plugin/plugin.json` only if plugin-bundled hooks are shipped

Do not modify:

- `packages/core/src/tools/recall.ts`
- `packages/core/src/memory/**`
- `packages/claude-code/**`

---

## Task C5.0: Reconfirm Hook Readiness

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c5-optional-codex-hooks.md`

- [ ] **Step 1: Check current Codex feature flags**

Run:

```bash
codex --version
codex features list
codex plugin --help
```

Expected: hooks are available and documented. If hook support is unavailable locally, stop and move C5 to future release.

- [ ] **Step 2: Re-read official docs**

Check:

- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/plugins/build

Expected: event names and config shape still match this plan.

- [ ] **Step 3: Commit skip/proceed decision**

If proceeding, commit plan checkbox update. If skipping, document why and do not implement C5.

---

## Task C5.1: Hook Command Contract

**Files:**
- Create: `packages/cli/src/commands/hook-codex.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/tests/codex-hooks.test.ts`

- [ ] **Step 1: Write failing hook command tests**

Assert:

- command accepts `hook codex session-start`
- command accepts `hook codex user-prompt-submit`
- command accepts `hook codex stop`
- invalid event exits non-zero
- malformed stdin fails open with valid JSON where Codex expects JSON
- `Stop` output is JSON, never plain text
- hook command does not open SQLite
- hook command does not call MCP
- any persisted marker is written atomically through temp-file-then-rename

Run:

```bash
npm test -- packages/cli/tests/codex-hooks.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement hook command**

Read stdin JSON, parse defensively, return minimal hook output:

- `SessionStart`: optional additional context
- `UserPromptSubmit`: no blocking, optional context
- `Stop`: no blocking, trigger marker only if implemented safely

Do not call MCP from hook command.
Do not open SQLite from hook command.
If a marker is needed, write only a small JSON file atomically. Prefer a
dedicated trigger queue if the marker is operational metadata rather than a real
conversation event.

- [ ] **Step 3: Verify command tests**

Run:

```bash
npm test -- packages/cli/tests/codex-hooks.test.ts
npm -w @locus/cli run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/cli/src/commands/hook-codex.ts packages/cli/src/index.ts packages/cli/tests/codex-hooks.test.ts
git commit -m "feat(cli): add codex hook command"
```

---

## Task C5.2: Hook Config Generation

**Files:**
- Create: `packages/cli/src/codex/hooks.ts`
- Modify: `packages/cli/tests/codex-hooks.test.ts`

- [ ] **Step 1: Write failing config tests**

Assert generated hooks config:

- includes `SessionStart`
- includes `UserPromptSubmit`
- includes `Stop`
- uses pinned `locus-memory@<version>` or installed binary path policy
- uses short timeout, for example 3 seconds
- uses Windows-safe command quoting
- does not include `PostToolUse`

Run:

```bash
npm test -- packages/cli/tests/codex-hooks.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement config builder**

Prefer structured JSON file generation over shell string mutation. Keep command strings minimal and test Windows paths with spaces.

- [ ] **Step 3: Verify config tests**

Run:

```bash
npm test -- packages/cli/tests/codex-hooks.test.ts
npm -w @locus/cli run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/cli/src/codex/hooks.ts packages/cli/tests/codex-hooks.test.ts
git commit -m "feat(cli): generate optional codex hook config"
```

---

## Task C5.3: Installer Flag And Doctor Diagnostics

**Files:**
- Modify: `packages/cli/src/commands/install-codex.ts`
- Modify: `packages/cli/src/commands/doctor-codex.ts`
- Modify: `packages/cli/tests/codex-install.test.ts`
- Modify: `packages/cli/tests/codex-doctor.test.ts`

- [ ] **Step 1: Write failing installer/doctor tests**

Assert:

- default install does not install hooks
- `--with-hooks` installs hooks config
- existing hook config is backed up before overwrite
- hook install is idempotent
- doctor reports `not configured`, `configured`, or `unavailable`

Run:

```bash
npm test -- packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-doctor.test.ts packages/cli/tests/codex-hooks.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Wire optional flag**

Do not change default install behavior. Add dry-run output for hook path and hook status.

- [ ] **Step 3: Wire doctor**

Doctor should inspect hook files/config without mutating them.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-doctor.test.ts packages/cli/tests/codex-hooks.test.ts
npm -w @locus/cli run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/cli/src/commands/install-codex.ts packages/cli/src/commands/doctor-codex.ts packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-doctor.test.ts
git commit -m "feat(cli): install optional codex hooks"
```

---

## Task C5.4: Plugin Packaging Hook Support

**Files:**
- Modify: `packages/codex/src/plugin-sync.ts`
- Modify: `packages/codex/tests/marketplace-bundle.test.ts`
- Modify: `plugins/locus-memory/.codex-plugin/plugin.json`

- [ ] **Step 1: Write failing marketplace tests**

Only do this if docs/local Codex confirm plugin-bundled hooks are stable enough.

Assert generated marketplace bundle can include hooks only when enabled by packaging policy.

- [ ] **Step 2: Implement packaging**

Keep hooks optional and clearly documented. Do not make the base plugin unusable without hooks.

- [ ] **Step 3: Verify marketplace tests**

Run:

```bash
npm test -- packages/codex/tests/marketplace-bundle.test.ts
npm run sync:codex-marketplace
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/codex/src/plugin-sync.ts packages/codex/tests/marketplace-bundle.test.ts plugins/locus-memory/.codex-plugin/plugin.json
git commit -m "feat(codex): package optional hook config"
```

---

## Task C5.5: Validation And Checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-05-04-track-c-c5-optional-codex-hooks.md`
- Modify: `docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md`

- [ ] **Step 1: Run validation**

Run:

```bash
npm test -- packages/cli/tests/codex-hooks.test.ts packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-doctor.test.ts packages/codex/tests/marketplace-bundle.test.ts
npm -w @locus/cli run typecheck
git diff --check
```

Expected: PASS if C5 executed. If C5 skipped, document skip reason.

- [ ] **Step 2: Update checkboxes and commit**

Run:

```bash
git add docs/superpowers/plans/2026-05-04-track-c-c5-optional-codex-hooks.md docs/superpowers/plans/2026-05-04-track-c-plan-bundle.md
git commit -m "docs(codex): record track c c5 validation"
```

- [ ] **Step 3: Create checkpoint tag if executed**

Run:

```bash
git tag -a track-c-c5-local -m "Track C C5 optional codex hooks local checkpoint"
```
