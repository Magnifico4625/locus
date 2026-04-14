# Codex VS Code Extension Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document a clear, honest setup and troubleshooting path for using Locus with the Codex VS Code extension without changing Codex import/runtime behavior.

**Architecture:** Keep Phase 6 documentation-only. Add one dedicated VS Code extension how-to document as the canonical answer, then update the root README, `@locus/codex` README, and config example to point to it. Preserve a strict boundary between what Locus controls locally and what still depends on upstream Codex extension MCP exposure.

**Tech Stack:** Markdown docs, repo READMEs, TOML example config, `rg` sanity checks, git.

---

## Scope

In scope:

- document the validated setup path for Locus with the Codex VS Code extension
- explain how the extension relates to Codex CLI MCP configuration
- document what works today through MCP tools/resources
- document what still depends on Codex JSONL import and upstream extension behavior
- provide a stable linkable guide for GitHub issues and README references

Out of scope:

- any changes to `packages/core/**`
- any changes to Codex import behavior, auto-import, or diagnostics logic
- any new MCP tools, plugin packaging, or IDE adapters
- any `packages/claude-code/**` changes
- promises that VS Code behaves identically to Codex CLI in every build

## Source Constraints

Phase 6 docs must stay aligned with current upstream surfaces. Before editing copy, refresh and rely only on primary sources:

- OpenAI Codex docs for CLI / MCP / Skills surfaces
- GitHub docs for the Codex VS Code extension status

As of planning time, the docs should preserve these boundaries:

- Codex CLI is the primary validated Locus path
- the Codex VS Code extension is still an upstream-controlled IDE surface
- Locus can document MCP setup and local diagnostics, but cannot guarantee extension-side MCP visibility in every build

## Design Decisions

- Create one dedicated guide so README sections can stay concise and link outward instead of duplicating troubleshooting prose.
- Keep the guide user-oriented and operational:
  - prerequisites
  - setup
  - restart/reload expectations
  - verification
  - diagnosis
  - known limitations
- Reuse the existing Codex diagnostics workflow from Phase 5:
  - `memory_search`
  - `memory_status`
  - `memory_doctor`
  - `memory_import_codex` only for manual catch-up
- Clarify that passive Codex history recall still depends on the Codex JSONL adapter and `LOCUS_CODEX_CAPTURE`, not on VS Code itself.
- Treat Windows path syntax as a first-class documentation concern:
  - examples should prefer forward slashes (`C:/...`) or explicitly escaped backslashes (`C:\\...`) in TOML strings
  - do not assume users know that raw backslashes can break config parsing
- Keep all wording honest about preview/extension limits; do not imply that a local skill alone makes the extension fully equivalent to CLI.

## File Structure

Create:

- `docs/codex-vscode-extension.md`

Modify:

- `README.md`
- `packages/codex/README.md`
- `packages/codex/config/config.toml.example`
- `docs/roadmap/codex.md`

Do not modify:

- `packages/core/**`
- `packages/codex/src/**`
- `packages/codex/skills/locus-memory/SKILL.md`
- `dist/**`

## Public Contract

After Phase 6:

- a user can answer “does Locus work with the Codex VS Code extension?” from repo docs alone
- a user can follow one documented MCP setup path for both Codex CLI and the extension
- a user can see the exact verification workflow:
  - run `memory_search`
  - inspect `memory_status`
  - inspect `memory_doctor`
  - use `memory_import_codex` only if manual catch-up is needed
- docs clearly distinguish:
  - what Locus controls
  - what depends on upstream Codex extension MCP exposure

## Risk Controls

- Do not write extension instructions that contradict the existing CLI setup path.
- Do not promise that VS Code automatically discovers skills or MCP servers beyond what upstream docs say.
- Do not turn Phase 6 into plugin packaging or adapter design work.
- Do not duplicate long troubleshooting text in multiple READMEs; link to the dedicated guide.
- Do not require screenshots for verification; prefer text examples that are easier to keep current across UI changes.
- Keep `config.toml.example` CLI-first, but annotate its relevance for the extension path.

### Task 0: Branch From The Phase 5 Checkpoint

**Files:** none

- [ ] Verify clean baseline:

```bash
git status --short --branch
```

Expected: clean working tree.

- [ ] Verify Phase 5 checkpoint tag exists:

```bash
git tag --list codex-doctor-status-phase-5-local
```

Expected: prints `codex-doctor-status-phase-5-local`.

- [ ] Create the Phase 6 branch from the stable checkpoint:

```bash
git checkout codex-doctor-status-phase-5-local
git checkout -b feature/codex-vscode-extension-docs
```

- [ ] Verify branch base:

```bash
git log --oneline -3
```

Expected: `0079656 chore(core): complete phase 5 validation` at or near `HEAD`.

### Task 1: Refresh Upstream Source Boundaries And Lock The Docs Scope

**Files:** none

- [ ] Re-check the current official upstream surfaces before editing docs:
  - OpenAI Codex CLI docs
  - OpenAI Codex Skills docs
  - GitHub Codex VS Code extension docs

- [ ] Confirm the wording boundaries that the repo docs must preserve:
  - Codex CLI remains the primary validated path
  - the VS Code extension may use the same MCP configuration model
  - upstream extension MCP visibility can still vary

- [ ] Record the concrete source links and version/date context that Phase 6 docs should cite indirectly in prose:
  - current Codex docs generation
  - current Codex CLI surface version/date when available
  - current GitHub extension preview status

- [ ] Commit the branch state only if you end up creating a local notes file.

### Task 2: Create The Canonical VS Code Extension How-To Guide

**Files:**
- Create: `docs/codex-vscode-extension.md`

- [ ] Write the dedicated guide with these sections:
  - What this guide covers
  - What works today
  - Prerequisites
  - Add Locus as an MCP server
  - Restart / reload expectations
  - Verify inside Codex
  - Diagnose missing memory results
  - Known limitations and upstream boundary

- [ ] Include concrete setup snippets:

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

```toml
[mcp_servers.locus]
command = "node"
args = ["/path/to/locus/dist/server.js"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
LOCUS_CODEX_CAPTURE = "metadata"
LOCUS_CAPTURE_LEVEL = "metadata"
```

- [ ] Add an explicit Windows note near the config examples:
  - TOML paths on Windows should use forward slashes (`C:/path/to/locus/dist/server.js`) or escaped backslashes (`C:\\path\\to\\locus\\dist\\server.js`)
  - explain briefly that raw backslashes can break config parsing or server startup

- [ ] In the restart/reload section, name the concrete VS Code action:
  - `Developer: Reload Window`
  - clarify that simply closing the chat tab is not a full MCP reload

- [ ] Include the verification workflow in the guide:
  - `memory_search`
  - `memory_status`
  - `memory_doctor`
  - `memory_import_codex({"latestOnly":true})` only if manual catch-up is needed

- [ ] Add one text-based success example instead of a screenshot:
  - show a short `memory_status` shape or checklist with fields such as `codexDiagnostics`, `sessionsDirExists`, `rolloutFilesFound`, and `captureMode`
  - keep it UI-agnostic so the guide survives extension UI changes

- [ ] Include a short “What Locus cannot fix” section:
  - extension build does not expose MCP tools/resources
  - extension has not reloaded config yet
  - upstream preview behavior differs from CLI

- [ ] Run sanity search:

```bash
rg -n "Codex VS Code Extension|memory_status|memory_doctor|memory_import_codex|Known limitations" docs/codex-vscode-extension.md
```

- [ ] Commit:

```bash
git add docs/codex-vscode-extension.md
git commit -m "docs(codex): add VS Code extension guide"
```

### Task 3: Update Root README To Point At The Guide

**Files:**
- Modify: `README.md`

- [ ] Tighten the existing `Codex VS Code Extension` section so it:
  - links to `docs/codex-vscode-extension.md`
  - states that the extension uses the Codex MCP configuration model
  - keeps CLI marked as the primary validated path
  - points users toward the diagnosis workflow from Phase 5

- [ ] Keep the root README concise:
  - short summary
  - pointer to the dedicated guide
  - no long troubleshooting duplication

- [ ] Ensure the Quick Start / Compatibility / Roadmap copy stays internally consistent after the edit.

- [ ] Run sanity search:

```bash
rg -n "Codex VS Code Extension|codex-vscode-extension|memory_status|memory_doctor" README.md
```

- [ ] Commit:

```bash
git add README.md
git commit -m "docs(codex): link VS Code extension guide from README"
```

### Task 4: Update `@locus/codex` README And Config Example

**Files:**
- Modify: `packages/codex/README.md`
- Modify: `packages/codex/config/config.toml.example`

- [ ] Update `packages/codex/README.md` so it:
  - links to the dedicated VS Code guide
  - explains that the same MCP server setup is used
  - preserves the honest preview/extension boundary
  - keeps manual import and diagnostics guidance aligned with Phases 3-5

- [ ] Update `config.toml.example` comments so they explain:
  - the same MCP server block is the relevant starting point for CLI and extension-backed Codex setups
  - after config changes, the user should restart Codex CLI or reload the extension host as needed
  - `CODEX_HOME` usually remains auto-detected

- [ ] Do not turn `config.toml.example` into an extension-specific file; keep it CLI-first and reusable.

- [ ] Run sanity search:

```bash
rg -n "VS Code|extension|reload|restart|LOCUS_CODEX_CAPTURE" packages/codex/README.md packages/codex/config/config.toml.example
```

- [ ] Commit:

```bash
git add packages/codex/README.md packages/codex/config/config.toml.example
git commit -m "docs(codex): align package docs with VS Code path"
```

### Task 5: Update The Codex Roadmap

**Files:**
- Modify: `docs/roadmap/codex.md`

- [ ] Mark Phase 6 as the active local documentation phase.

- [ ] Expand the Phase 6 description so it reflects the actual deliverable:
  - dedicated guide
  - README/config updates
  - explicit explanation of upstream extension limits

- [ ] Move immediate next steps from “start Phase 6” to Phase 6 validation / Phase 7 planning.

- [ ] Keep the roadmap honest that this phase improves documentation and supportability, not runtime capability.

- [ ] Run sanity search:

```bash
rg -n "Phase 6|VS Code|extension|documentation" docs/roadmap/codex.md
```

- [ ] Commit:

```bash
git add docs/roadmap/codex.md
git commit -m "docs(codex): mark phase 6 VS Code docs work"
```

### Task 6: Validation

**Files:** all modified docs/config files

- [ ] Run a combined docs sanity search:

```bash
rg -n "Codex VS Code Extension|memory_status|memory_doctor|memory_import_codex|LOCUS_CODEX_CAPTURE|restart|reload" README.md packages/codex/README.md packages/codex/config/config.toml.example docs/codex-vscode-extension.md docs/roadmap/codex.md
```

- [ ] Run:

```bash
npm run lint
```

Expected: PASS, with the existing `dist/server.js` max-size info only.

- [ ] Review final branch diff:

```bash
git diff --stat codex-doctor-status-phase-5-local..HEAD
```

- [ ] Review commit sequence:

```bash
git log --oneline codex-doctor-status-phase-5-local..HEAD
```

- [ ] Update this plan file with completed checkboxes.

- [ ] Final checkpoint commit if needed:

```bash
git add docs/superpowers/plans/2026-04-14-codex-vscode-extension-phase-6.md
git commit -m "docs(codex): complete phase 6 validation"
```

- [ ] Create local checkpoint tag:

```bash
git tag -a codex-vscode-extension-phase-6-local -m "Codex VS Code extension documentation phase 6 local checkpoint"
```

## Manual Verification

After the docs land:

1. Open the dedicated guide and verify it answers the issue-level question: “Can I use Locus with the Codex VS Code extension?”
2. Confirm the root README points to the guide rather than duplicating the full troubleshooting flow.
3. Confirm `packages/codex/README.md` and `config.toml.example` do not contradict the guide.
4. Confirm the guide tells users to verify memory with `memory_search`, `memory_status`, and `memory_doctor` before escalating to manual import.
5. Confirm the guide clearly separates:
   - local Locus setup problems
   - upstream Codex extension MCP visibility problems

## Notes For Execution

- Keep the wording stable even if upstream docs are slightly vague; prefer conservative language over aspirational wording.
- If official docs move, update source references first and then edit repo docs.
- If you find that the extension now has stronger official MCP guarantees than expected, reflect that, but keep CLI as the primary tested path unless you also run a local extension smoke check.
- If you cannot verify an extension-specific behavior locally, say so explicitly in the docs instead of implying parity.
- Do not add new product claims in README badges, version highlights, or roadmap entries just because the docs improved.
