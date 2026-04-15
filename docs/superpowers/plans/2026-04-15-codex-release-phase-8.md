# Codex Release Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the completed Codex work from local phase branches into one GitHub-ready release only after local Codex acceptance proves the real user workflow works end-to-end.

**Architecture:** Treat `feature/codex-plugin-packaging` as the cumulative integration branch for Phases 1-7. Phase 8 does not merge seven old branches independently; it creates one release branch from the stable Phase 7 checkpoint, updates the locally installed Codex-facing artifacts, runs real acceptance inside Codex, then prepares a single GitHub PR and final release tag from that validated state.

**Tech Stack:** git, GitHub CLI (`gh`), Codex CLI, MCP/Locus tools, Markdown docs, package version metadata, Node.js build/test scripts.

---

## Scope

In scope:

- create a release branch from the stable Phase 7 local checkpoint
- rebuild and locally update the real Codex-facing install paths (`dist`, installed skill, repo-local plugin bundle)
- run a real acceptance gate through Codex workflows before any GitHub push
- prepare version bump, changelog, release notes, and roadmap/release docs
- push one release branch to GitHub, open one PR, and publish one final release tag after approval

Out of scope:

- new Codex runtime features
- any new Claude Code behavior changes
- merging all historical feature branches separately
- force-pushing or rewriting shared GitHub history
- public npm publishing beyond the existing GitHub release flow

## Release Strategy

- Use the already integrated cumulative branch state, not a seven-branch merge train.
- Start Phase 8 from `codex-plugin-packaging-phase-7-local`.
- Create one release branch: `release/codex-v3.3.0`.
- Keep local phase checkpoint tags local; only the final public release tag should be pushed.
- Prefer a single GitHub PR from the release branch into `main`.
- Prefer squash merge into `main` so `main` stays clean while the detailed phase history remains available on the release branch and in local tags.

## File Structure

Create:

- `docs/releases/v3.3.0.md`
- `docs/superpowers/plans/2026-04-15-codex-release-phase-8.md`

Modify:

- `package.json`
- `package-lock.json`
- `packages/core/package.json`
- `packages/codex/package.json`
- `packages/shared-runtime/package.json`
- `plugins/locus-memory/.codex-plugin/plugin.json`
- `CHANGELOG.md`
- `README.md`
- `docs/roadmap/codex.md`

Possibly modify:

- `dist/**`
- `plugins/locus-memory/skills/locus-memory/SKILL.md`
- `.agents/plugins/marketplace.json`

Do not modify:

- `packages/claude-code/**`
- `packages/core/src/**` unless the local acceptance gate finds a real bug

## Version Target

Recommended release target: `v3.3.0`

Reasoning:

- `3.2.x` was already conceptually consumed by the earlier Codex adapter and manual-import milestones in the roadmap
- Phase 7 adds plugin packaging and materially improves installation UX
- `3.3.0` is the cleanest public version for “Codex support is now a real, documented, diagnosable product line”

If acceptance or release prep exposes a blocker, stop before push and fix on the release branch. Do not publish a half-working `v3.3.0`.

## Acceptance Gate

GitHub push is blocked until all of the following are true locally:

- built server matches the release branch state
- installed Codex skill is updated
- repo-local Codex plugin bundle is updated
- `memory_status` works in the real Codex environment
- `memory_doctor` works in the real Codex environment
- `memory_search` returns expected project memory
- `memory_import_codex` works as an explicit catch-up path
- no unexpected Claude regressions are introduced by the release prep

### Task 0: Branch From The Stable Phase 7 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree on `feature/codex-plugin-packaging`.

- [ ] Verify the Phase 7 checkpoint tag exists:

```bash
git tag --list codex-plugin-packaging-phase-7-local
```

Expected: prints `codex-plugin-packaging-phase-7-local`.

- [ ] Create the release branch from the stable checkpoint:

```bash
git switch --detach codex-plugin-packaging-phase-7-local
git switch -c release/codex-v3.3.0
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `8b75ced docs(codex): complete phase 7 validation` at or near `HEAD`.

### Task 1: Rebuild And Update The Local Codex Install Paths

**Files:**
- Modify: `dist/**`
- Possibly modify: `plugins/locus-memory/skills/locus-memory/SKILL.md`

- [ ] Build the release branch state:

```bash
npm run build
```

Expected: PASS.

- [ ] Sync the installed Codex skill:

```bash
npm run sync:codex-skill
```

Expected: installed skill updates cleanly, with overwrite/backup behavior only if local drift exists.

- [ ] Sync the repo-local Codex plugin bundle:

```bash
npm run sync:codex-plugin
```

Expected: plugin skill copy stays aligned with the canonical repo skill.

- [ ] Inspect the active Codex MCP registration:

```bash
codex mcp get locus
```

Expected: the `locus` MCP entry exists and still points at the intended local server path/config.

- [ ] Verify the repo is still clean or that only expected built artifacts changed:

```bash
git status --short
```

### Task 2: Run The Real Local Codex Acceptance Gate

**Files:** none unless acceptance finds a defect

- [ ] In a real Codex session attached to any test project, run `memory_status` and verify:
  - `codexAutoImport` is present
  - `codexDiagnostics` is present when `CODEX_HOME` is configured
  - capture mode and sessions diagnostics look correct

- [ ] In the same Codex session, run `memory_doctor` and verify:
  - no unexpected failures
  - any warnings are expected and actionable

- [ ] Run `memory_search` before manual import and verify the baseline behavior:
  - the call itself works in the real Codex session
  - an empty result is acceptable if this Codex memory root has not yet accumulated searchable project or conversation data

- [ ] Run `memory_import_codex` manually against a known older, contentful session using `since` and verify:
  - it returns stable metrics
  - imported event counts increase
  - this is the primary acceptance selector for Phase 8; `sessionId` may be recorded but is not a release gate

- [ ] Repeat the same `memory_import_codex({ since: ... })` call and verify idempotency:
  - `imported=0`
  - duplicates rise or remain stable as expected

- [ ] Run a second `memory_search` after the successful `since` import and verify only as a secondary sanity check:
  - the call still works
  - do not require meaningful dialogue-text recall when `LOCUS_CODEX_CAPTURE=metadata`
  - for Phase 8, `metadata` mode acceptance is about ingestion and idempotency, not full semantic conversation recall

- [ ] Verify the “agent behavior” path, not only direct tool calls:
  - ask Codex a repo-history question that should naturally trigger the Locus workflow
  - confirm the skill/plugin path still nudges toward `memory_search` / `memory_status` as designed

- [ ] Record in the release notes that richer conversational recall from Codex dialogue is a future-release track for `redacted` / `full` capture modes, not a blocker for the `metadata`-based `v3.3.0` release.

- [ ] If any step fails, stop release work immediately and fix the issue on `release/codex-v3.3.0` before continuing.

### Task 3: Prepare Release Metadata And Docs

**Files:**
- Create: `docs/releases/v3.3.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/core/package.json`
- Modify: `packages/codex/package.json`
- Modify: `packages/shared-runtime/package.json`
- Modify: `plugins/locus-memory/.codex-plugin/plugin.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/roadmap/codex.md`

- [ ] Bump the public release version to `3.3.0` in:
  - root `package.json`
  - `packages/core/package.json`
  - `packages/codex/package.json`
  - `packages/shared-runtime/package.json`
  - `plugins/locus-memory/.codex-plugin/plugin.json`

- [ ] Refresh `package-lock.json` by running npm after the version bump. Do not edit the lockfile manually:

```bash
npm install
```

Expected: `package-lock.json` updates to the new workspace/package versions.

- [ ] Update `CHANGELOG.md`:
  - add `## [3.3.0] - 2026-04-15`
  - summarize Phases 1-7 as one public release
  - keep the format aligned with existing Keep a Changelog structure

- [ ] Update `README.md`:
  - replace the old “Current” version line
  - reflect Codex as shipped functionality, not future work

- [ ] Update `docs/roadmap/codex.md`:
  - mark Phase 7 as completed locally
  - mark Phase 8 as the active release phase
  - point Phase 8 to this plan file

- [ ] Create `docs/releases/v3.3.0.md` with:
  - release title
  - short summary
  - key highlights
  - upgrade notes
  - local validation summary
  - known limitations that are still upstream-dependent

- [ ] Run:

```bash
npm run build
```

Expected: PASS and refreshes any tracked `dist/**` output after version/doc changes if needed.

- [ ] Commit:

```bash
git add package.json package-lock.json packages/core/package.json packages/codex/package.json packages/shared-runtime/package.json plugins/locus-memory/.codex-plugin/plugin.json CHANGELOG.md README.md docs/roadmap/codex.md docs/releases/v3.3.0.md dist
git commit -m "release: prepare v3.3.0 metadata and notes"
```

### Task 4: Final Release-Branch Validation

**Files:** all release branch files

- [ ] Run the full validation suite:

```bash
npm run check
```

Expected: PASS.

- [ ] Reconfirm the Codex-facing assets after the version bump:

```bash
npm run sync:codex-skill
npm run sync:codex-plugin
```

Expected: PASS.

- [ ] Review the release branch against `main`:

```bash
git diff --stat main..HEAD
git log --oneline --decorate main..HEAD
```

- [ ] Confirm the working tree is clean:

```bash
git status --short --branch
```

- [ ] Commit any final cleanup if needed:

```bash
git add <files>
git commit -m "chore(release): finalize v3.3.0 branch"
```

### Task 5: Push The Release Branch And Open The GitHub PR

**Files:** none

- [ ] Verify GitHub auth:

```bash
gh auth status
```

Expected: authenticated for `origin`.

- [ ] Push the release branch:

```bash
git push -u origin release/codex-v3.3.0
```

- [ ] Open one PR into `main`:

```bash
gh pr create --base main --head release/codex-v3.3.0 --title "release: v3.3.0 codex memory" --body-file docs/releases/v3.3.0.md
```

- [ ] Do not merge yet until the PR description, diff, and local acceptance summary are reviewed one last time.

### Task 6: Merge, Tag, And Publish The GitHub Release

**Files:** none

- [ ] Merge the PR with squash merge after explicit approval:

```bash
gh pr merge --squash --delete-branch=false
```

- [ ] Update local `main`:

```bash
git switch main
git pull --ff-only origin main
```

- [ ] Create the final public tag on `main`:

```bash
git tag -a v3.3.0 -m "Locus v3.3.0: Codex support, diagnostics, skill, plugin packaging"
git push origin v3.3.0
```

- [ ] Publish the GitHub release from the curated notes:

```bash
gh release create v3.3.0 --title "v3.3.0" --notes-file docs/releases/v3.3.0.md
```

## Manual Verification

Before push:

1. Confirm the real local Codex session can use `memory_status`, `memory_doctor`, `memory_search`, and `memory_import_codex`.
2. Confirm the installed skill and the repo-local plugin bundle both point at the expected current workflow.
3. Confirm `README.md`, `CHANGELOG.md`, and `docs/releases/v3.3.0.md` all tell the same release story.
4. Confirm `git diff main..release/codex-v3.3.0` contains only intended release changes.

After merge:

1. Confirm GitHub PR is merged into `main`.
2. Confirm GitHub tag `v3.3.0` exists.
3. Confirm GitHub release text matches `docs/releases/v3.3.0.md`.

## Notes For Execution

- If the real Codex acceptance gate fails, do not push “for visibility”; fix first.
- Do not push the local phase checkpoint tags unless there is a deliberate reason to expose them publicly.
- Keep the release branch cumulative and linear. Do not start merging old feature branches into it.
- If the user wants a cleaner public history, preserve the detailed phase commits on the release branch and squash only the PR into `main`.
- If upstream Codex/VS Code behavior differs during acceptance, document that as a release limitation rather than pretending Locus owns the problem.
