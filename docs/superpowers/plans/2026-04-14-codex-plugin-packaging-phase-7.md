# Codex Plugin Packaging Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Locus as a repo-local Codex plugin so installation and onboarding improve without replacing or breaking the existing manual MCP setup.

**Architecture:** Implement Phase 7 as local plugin packaging, not public distribution. Create a repo-local plugin bundle under `plugins/locus-memory/`, wire it into a repo marketplace at `.agents/plugins/marketplace.json`, and keep the existing MCP/manual setup as the canonical fallback. Make the plugin bundle derive its skill content from the existing canonical Codex skill so the workflow does not drift.

**Tech Stack:** Markdown docs, JSON manifests, local Codex plugin structure (`.codex-plugin/plugin.json`, `.mcp.json`, `skills/`), Node.js scripts, Vitest, git.

---

## Scope

In scope:

- research and lock the current local Codex plugin packaging format
- add a repo-local plugin bundle for Locus
- add a repo-local marketplace entry so Codex can discover the plugin from the repository
- add a sync/build helper so plugin skill content stays aligned with the canonical Codex skill
- document plugin installation/testing while keeping manual MCP setup supported

Out of scope:

- any changes to `packages/core/**` runtime behavior
- any new capture, search, import, or diagnostics behavior
- public plugin directory publishing
- npm-based plugin installation that assumes a published package already exists
- any `packages/claude-code/**` changes

## Source Constraints

Phase 7 must stay grounded in current official Codex plugin docs:

- plugin manifest at `.codex-plugin/plugin.json`
- optional bundled `skills/` and `.mcp.json`
- local installation through repo marketplace or personal marketplace
- official public plugin publishing still marked as coming soon

Primary sources used for this plan:

- OpenAI Codex Plugins overview/build docs:
  - https://developers.openai.com/codex/plugins
  - https://developers.openai.com/codex/plugins/build
- OpenAI Codex changelog:
  - https://developers.openai.com/codex/changelog

Critical upstream facts to preserve:

- local repo marketplaces are supported now
- a plugin bundle may include `skills/` and `.mcp.json`
- manifest paths must stay relative to the plugin root and start with `./`
- self-serve official public publishing is not the target of this phase

## Design Decisions

- Build a repo-local plugin first because it is the stable surface documented today and does not require npm publishing.
- Keep manual MCP setup fully documented and supported; the plugin is packaging, not the new only path.
- Use one repo-local marketplace:
  - `.agents/plugins/marketplace.json`
  - `plugins/locus-memory/`
- Keep one source of truth for skill behavior:
  - canonical skill remains `packages/codex/skills/locus-memory/SKILL.md`
  - plugin skill copy is synced/generated from it
- Bundle only what the plugin needs now:
  - `.codex-plugin/plugin.json`
  - `.mcp.json`
  - `skills/locus-memory/SKILL.md`
- Do not overreach into polished public marketplace metadata or image assets unless needed for local install surfaces.
- Keep Phase 7 honest that repo-local plugin install is for local onboarding/testing; it does not replace future public plugin publishing.

## File Structure

Create:

- `plugins/locus-memory/.codex-plugin/plugin.json`
- `plugins/locus-memory/.mcp.json`
- `plugins/locus-memory/skills/locus-memory/SKILL.md`
- `.agents/plugins/marketplace.json`
- `scripts/sync-codex-plugin.mjs`
- `packages/codex/tests/plugin-bundle.test.ts`

Modify:

- `package.json`
- `packages/codex/README.md`
- `README.md`
- `docs/roadmap/codex.md`
- `docs/codex-vscode-extension.md`
- `docs/superpowers/plans/2026-04-14-codex-plugin-packaging-phase-7.md`

Potentially modify:

- `packages/codex/src/index.ts`
- `packages/codex/src/skill-sync.ts`

Do not modify:

- `packages/core/**`
- `packages/codex/src/importer.ts`
- `packages/claude-code/**`

## Public Contract

After Phase 7:

- the repo contains a valid local Codex plugin bundle for Locus
- the repo contains a local marketplace entry that points to that plugin
- the plugin exposes the existing Locus Codex skill and MCP server configuration guidance
- plugin packaging improves onboarding, but manual `codex mcp add ...` setup remains documented and supported

## Packaging Strategy

Phase 7 should target repo-local installation first:

- plugin root: `plugins/locus-memory/`
- marketplace: `.agents/plugins/marketplace.json`
- source path in marketplace: `./plugins/locus-memory`

The plugin bundle should include:

- `.codex-plugin/plugin.json`
- `skills/locus-memory/SKILL.md`
- `.mcp.json`

The plugin’s MCP config should stay local-dev-friendly:

- use `node`
- point to the repo’s built `dist/server.js`
- keep paths relative to the plugin root where possible

If relative MCP paths prove too brittle during implementation, fall back to documenting the plugin as skill-first packaging while keeping MCP setup manual. Do not fake a broken auto-config path just to satisfy the plugin format.

## Risk Controls

- Do not replace manual MCP setup docs with plugin-only docs.
- Do not assume public plugin publishing exists yet.
- Do not duplicate skill instructions manually across two files without a sync mechanism.
- Do not ship a marketplace entry that points to the wrong path or uses non-`./` relative paths.
- Do not over-couple plugin packaging to Windows-only or Unix-only path assumptions.
- If `.mcp.json` portability is uncertain, verify the local repo marketplace path first before documenting stronger claims.

### Task 0: Branch From The Phase 6 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree.

- [ ] Verify Phase 6 checkpoint tag exists:

```bash
git tag --list codex-vscode-extension-phase-6-local
```

Expected: prints `codex-vscode-extension-phase-6-local`.

- [ ] Create the Phase 7 branch from the stable checkpoint:

```bash
git checkout codex-vscode-extension-phase-6-local
git checkout -b feature/codex-plugin-packaging
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `cef278d docs(codex): complete phase 6 validation` at or near `HEAD`.

### Task 1: Lock The Plugin Contract With Failing Tests

**Files:**
- Create: `packages/codex/tests/plugin-bundle.test.ts`

- [ ] Add failing tests that define the local plugin contract:
  - plugin bundle exists at `plugins/locus-memory/`
  - required manifest exists at `.codex-plugin/plugin.json`
  - manifest paths use `./`-prefixed relative paths
  - plugin skill exists and matches the canonical Codex skill content
  - repo marketplace exists and points to `./plugins/locus-memory`

- [ ] Include at least one test for `.mcp.json` shape:
  - file exists
  - file contains a local MCP server definition for Locus

- [ ] Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts
```

Expected: FAIL because the plugin bundle and marketplace do not exist yet.

- [ ] Commit:

```bash
git add packages/codex/tests/plugin-bundle.test.ts
git commit -m "test(codex): define plugin packaging contract"
```

### Task 2: Create The Plugin Bundle Skeleton

**Files:**
- Create: `plugins/locus-memory/.codex-plugin/plugin.json`
- Create: `plugins/locus-memory/.mcp.json`
- Create: `plugins/locus-memory/skills/locus-memory/SKILL.md`
- Create: `.agents/plugins/marketplace.json`

- [ ] Create a minimal plugin manifest with:
  - stable kebab-case `name`
  - `version`
  - `description`
  - `skills`
  - `mcpServers`
  - lightweight `interface` metadata if useful for local install surfaces

- [ ] Create `.mcp.json` with the local Locus MCP server definition.

- [ ] Add the repo marketplace entry:
  - marketplace name
  - local source entry
  - `source.path` = `./plugins/locus-memory`
  - install policy suitable for local availability/testing

- [ ] Seed the plugin skill copy from `packages/codex/skills/locus-memory/SKILL.md`.

- [ ] Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts
```

Expected: still FAIL if the skill copy or metadata is incomplete, but now fail for content/detail reasons rather than missing files.

- [ ] Commit:

```bash
git add plugins/locus-memory/.codex-plugin/plugin.json plugins/locus-memory/.mcp.json plugins/locus-memory/skills/locus-memory/SKILL.md .agents/plugins/marketplace.json
git commit -m "feat(codex): add local plugin bundle skeleton"
```

### Task 3: Add Plugin Sync Tooling

**Files:**
- Create: `scripts/sync-codex-plugin.mjs`
- Modify: `package.json`
- Potentially modify: `packages/codex/src/index.ts`

- [ ] Add a sync/build script that:
  - copies the canonical skill into the plugin bundle
  - validates that plugin-relative paths still match the bundle layout
  - fails loudly if required source files are missing

- [ ] Add a root script:

```json
"sync:codex-plugin": "node scripts/sync-codex-plugin.mjs"
```

- [ ] Keep this helper repo-local. Do not make it install into a personal marketplace yet unless implementation proves that path is stable and worthwhile.

- [ ] Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts
```

Expected: PASS once the bundle layout and synced skill content are correct.

- [ ] Commit:

```bash
git add scripts/sync-codex-plugin.mjs package.json packages/codex/tests/plugin-bundle.test.ts plugins/locus-memory/skills/locus-memory/SKILL.md
git commit -m "feat(codex): add plugin bundle sync script"
```

### Task 4: Validate Plugin Metadata And Marketplace Wiring

**Files:**
- Modify: `packages/codex/tests/plugin-bundle.test.ts`
- Modify: plugin bundle files as needed

- [ ] Extend tests to verify:
  - `plugin.json` uses `./skills/` and `./.mcp.json`
  - marketplace source path is exactly `./plugins/locus-memory`
  - the canonical skill and plugin skill remain byte-equal after sync
  - `.mcp.json` still points at the intended local Locus server command

- [ ] Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm run lint
```

Expected: PASS, with the existing `dist/server.js` max-size info only.

- [ ] Commit formatting or metadata follow-up if needed:

```bash
git add plugins/locus-memory/.codex-plugin/plugin.json plugins/locus-memory/.mcp.json .agents/plugins/marketplace.json packages/codex/tests/plugin-bundle.test.ts
git commit -m "chore(codex): validate plugin bundle metadata"
```

### Task 5: Document Plugin Installation And Boundaries

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `docs/codex-vscode-extension.md`

- [ ] Add concise plugin packaging docs to the root README:
  - local plugin exists in the repo
  - repo marketplace exists
  - manual MCP setup remains supported

- [ ] Update `packages/codex/README.md` with:
  - plugin bundle location
  - repo marketplace path
  - `npm run sync:codex-plugin`
  - plugin as optional packaging, not a new requirement

- [ ] Update `docs/codex-vscode-extension.md` if needed so it does not contradict plugin packaging:
  - manual MCP setup remains the stable documented fallback
  - plugin packaging is an additional onboarding path, not a replacement guarantee

- [ ] Keep docs honest that official public plugin publishing is still “coming soon”.

- [ ] Run sanity search:

```bash
rg -n "plugin|marketplace|sync:codex-plugin|manual MCP|public publishing" README.md packages/codex/README.md docs/codex-vscode-extension.md
```

- [ ] Commit:

```bash
git add README.md packages/codex/README.md docs/codex-vscode-extension.md
git commit -m "docs(codex): document local plugin packaging"
```

### Task 6: Update The Codex Roadmap

**Files:**
- Modify: `docs/roadmap/codex.md`

- [ ] Mark Phase 7 as the active local plugin-packaging phase.

- [ ] Expand the Phase 7 section so it reflects the actual deliverable:
  - repo-local plugin bundle
  - repo marketplace
  - optional plugin path alongside manual MCP setup

- [ ] Keep the roadmap explicit that this phase improves onboarding, not core runtime capability.

- [ ] Move immediate next steps toward Phase 7 validation and later release planning.

- [ ] Run sanity search:

```bash
rg -n "Phase 7|plugin|marketplace|manual MCP|public" docs/roadmap/codex.md
```

- [ ] Commit:

```bash
git add docs/roadmap/codex.md
git commit -m "docs(codex): mark phase 7 plugin packaging work"
```

### Task 7: Targeted Validation And Local Smoke Prep

**Files:** all plugin-related files

- [ ] Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts
```

Expected: PASS.

- [ ] Run:

```bash
npm -w @locus/codex run typecheck
```

Expected: PASS if any package code/helpers were added.

- [ ] Run:

```bash
npm run lint
```

Expected: PASS, with the existing `dist/server.js` max-size info only.

- [ ] Review the repo-local plugin install paths:
  - `plugins/locus-memory/`
  - `.agents/plugins/marketplace.json`

- [ ] If the implementation includes a documented repo-local smoke flow, verify that the docs and paths match exactly.

- [ ] Commit any final cleanup if needed:

```bash
git add <files>
git commit -m "chore(codex): finalize plugin packaging validation"
```

### Task 8: Full Validation And Phase 7 Checkpoint

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

- [ ] Review final branch diff:

```bash
git diff --stat codex-vscode-extension-phase-6-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-vscode-extension-phase-6-local..HEAD
```

- [ ] Update this plan file with completed checkboxes.

- [ ] Final checkpoint commit if needed:

```bash
git add docs/superpowers/plans/2026-04-14-codex-plugin-packaging-phase-7.md
git commit -m "docs(codex): complete phase 7 validation"
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-plugin-packaging-phase-7-local -m "Codex plugin packaging phase 7 local checkpoint"
```

## Manual Verification

After implementation:

1. Confirm the repo contains `plugins/locus-memory/` with `.codex-plugin/plugin.json`, `.mcp.json`, and the bundled skill.
2. Confirm `.agents/plugins/marketplace.json` points to `./plugins/locus-memory`.
3. Confirm the plugin skill still matches `packages/codex/skills/locus-memory/SKILL.md`.
4. Confirm the docs still describe manual MCP setup as fully supported.
5. If a repo-local smoke path is attempted, confirm Codex can see the repo marketplace entry after restart.

## Notes For Execution

- Prefer the repo marketplace over the personal marketplace in Phase 7. It is easier to test, easier to document, and safer for a local repository workflow.
- If `.mcp.json` cannot reliably point to a portable local server path, keep plugin packaging skill-first and document MCP setup separately rather than shipping a misleading config.
- Do not block the plugin packaging phase on future npm publishing.
- If official plugin docs change during implementation, re-check the manifest path rules and marketplace layout before continuing.
- Public Plugin Directory publishing is explicitly out of scope until the upstream self-serve flow is available and stable.
