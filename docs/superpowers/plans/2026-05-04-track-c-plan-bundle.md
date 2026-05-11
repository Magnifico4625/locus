# Track C Plan Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break Track C into executable, testable plans that make Codex `redacted` recall meaningfully useful without depending on hooks or LLM summarization.

**Architecture:** Track C is split into six dependent subprojects. `C1` builds the recall engine and query understanding, `C2` improves what redacted capture keeps, `C3` improves durable extraction and topic keys, `C4` exposes inspectability, `C5` adds optional hook support without becoming a release gate, and `C6` proves the product story with fixtures, docs, and runtime validation.

**Tech Stack:** Node.js 22+, TypeScript, npm workspaces, Vitest, SQLite through existing adapters, MCP tool contracts, Codex JSONL/transcript import, optional Codex hooks.

---

## Master Spec

- Source spec: `docs/superpowers/specs/2026-05-04-track-c-richer-codex-recall-design.md`
- Roadmap anchor: `docs/roadmap/codex-next.md`
- Current baseline: `v3.5.3` one-command install release

## Execution Order

1. `C1` Recall Engine v2
2. `C2` Capture/Relevance v2
3. `C3` Durable Extractor v2
4. `C4` Inspectability And Trust Surfaces
5. `C5` Optional Codex Hooks
6. `C6` Acceptance And Docs Truth Pass

`C5` is optional for `v3.6.0`. If C1-C4 pass acceptance and hooks are not ready, ship hooks later in `v3.6.x`.

## Plan Files

- `docs/superpowers/plans/2026-05-04-track-c-c1-recall-engine-v2.md`
- `docs/superpowers/plans/2026-05-04-track-c-c2-capture-relevance-v2.md`
- `docs/superpowers/plans/2026-05-04-track-c-c3-durable-extractor-v2.md`
- `docs/superpowers/plans/2026-05-04-track-c-c4-inspectability.md`
- `docs/superpowers/plans/2026-05-04-track-c-c5-optional-codex-hooks.md`
- `docs/superpowers/plans/2026-05-04-track-c-c6-acceptance-docs.md`

## Checkpoint Convention

- [x] Before `C1`, create baseline tag: `track-c-baseline-2026-05-04`
- [x] After `C1`, tag: `track-c-c1-local`
- [x] After `C2`, tag: `track-c-c2-local`
- [x] After `C3`, tag: `track-c-c3-local`
- [x] After `C4`, tag: `track-c-c4-local`
- [x] After `C5` if executed, tag: `track-c-c5-local`
- [x] After `C6`, tag: `track-c-c6-local`

## Review Gates

- [ ] Review and approve this bundle before implementation starts.
- [ ] Review and approve each sub-plan before its first task starts.
- [ ] Execute one sub-plan at a time.
- [ ] Do not begin the next task until the user approves the previous task report.
- [ ] Request review at the end of each sub-plan.
- [ ] Run targeted tests during each task and focused validation before each checkpoint tag.

## Hard Rules For Every Sub-Plan

- [ ] No semantic recall claim without fixture-backed evidence.
- [ ] No hook dependency for `v3.6.0` core recall quality.
- [ ] No automatic deletion or hidden cleanup.
- [ ] No Claude Code changes unless a shared contract test proves the need.
- [ ] Keep `metadata`, `redacted`, and `full` documentation truthful.
- [ ] Keep new fields backward-compatible unless a plan explicitly says otherwise.
- [ ] Store low-confidence extractor candidates nowhere durable; rely on retained conversation context instead.

## Final Release Gate

Before `v3.6.0` can be called ready:

- [x] `npm run check` passes.
- [x] Focused Track C tests pass.
- [x] Existing Track A/B regression tests pass.
- [ ] Real local Codex redacted recall smoke test passes.
- [ ] `memory_status`, `memory_doctor`, `memory_review`, and `memory_audit` tell the same capture/recall story.
- [x] README, roadmap, acceptance matrix, package docs, plugin skill, and release notes avoid unvalidated desktop parity claims.

Validation note (2026-05-11): focused Track C/Track A validation passed,
`npm run build` passed, `npm run check` passed with 1265 tests, and
`git diff --check` passed. The live MCP smoke was healthy in `redacted` mode but
was bound to `C:\Users\Admin\.codex`, so it is not counted as the final
repo-bound Codex redacted recall smoke.
