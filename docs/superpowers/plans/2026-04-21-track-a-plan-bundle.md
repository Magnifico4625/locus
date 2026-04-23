# Track A Plan Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** break Track A into six executable, testable implementation plans that restore Locus memory trust for Codex without mixing unrelated concerns.

**Architecture:** Track A is intentionally split into six dependent subprojects. `A1` establishes runtime truth, `A2` fixes what gets captured, `A3` adds durable structured memory, `A4` makes recall natural, `A5` makes retention safe and inspectable, and `A6` closes the loop with real acceptance checks and docs truthfulness. Each plan ends with a local checkpoint tag so the next plan has a clean baseline.

**Tech Stack:** Markdown, Git, npm workspaces, Node.js 22+, TypeScript, plain ESM JS in `packages/shared-runtime`, Vitest, MCP tool contracts.

---

## Master Spec

- Source spec: `docs/superpowers/specs/2026-04-21-track-a-codex-memory-trust-design.md`
- Product roadmap anchor: `docs/roadmap/codex-next.md`

## Execution Order

1. `A1` Runtime Truth
2. `A2` Bounded Hybrid Capture
3. `A3` Local High-Value Extraction
4. `A4` Recall UX
5. `A5` Retention And Cleanup
6. `A6` Acceptance And Docs Truth Pass

## Plan Files

- `docs/superpowers/plans/2026-04-21-track-a-a1-runtime-truth.md`
- `docs/superpowers/plans/2026-04-21-track-a-a2-bounded-hybrid-capture.md`
- `docs/superpowers/plans/2026-04-21-track-a-a3-high-value-extraction.md`
- `docs/superpowers/plans/2026-04-21-track-a-a4-recall-ux.md`
- `docs/superpowers/plans/2026-04-21-track-a-a5-retention-cleanup.md`
- `docs/superpowers/plans/2026-04-21-track-a-a6-acceptance-docs.md`

## Checkpoint Convention

- [x] Before `A1`, create baseline tag: `track-a-baseline-2026-04-21`
- [x] After `A1`, tag: `track-a-a1-local`
- [x] After `A2`, tag: `track-a-a2-local`
- [x] After `A3`, tag: `track-a-a3-local`
- [x] After `A4`, tag: `track-a-a4-local`
- [x] After `A5`, tag: `track-a-a5-local`
- [x] After `A6`, tag: `track-a-a6-local`

## Completed Checkpoints

| Plan | Local tag | Checkpoint commit |
|------|-----------|-------------------|
| `A1` Runtime Truth | `track-a-a1-local` | `642fdc9` `chore(codex): complete track a a1 validation` |
| `A2` Bounded Hybrid Capture | `track-a-a2-local` | `74fb2a8` `chore(codex): complete track a a2 validation` |
| `A3` Local High-Value Extraction | `track-a-a3-local` | `225efac` `chore(codex): complete track a a3 validation` |
| `A4` Recall UX | `track-a-a4-local` | `52c8d57` `chore(codex): complete track a a4 validation` |
| `A5` Retention And Cleanup | `track-a-a5-local` | `645f8d4` `chore(codex): complete track a a5 validation` |
| `A6` Acceptance And Docs Truth Pass | `track-a-a6-local` | `d0677ba` `chore(codex): complete track a a6 validation` |

## Review Gates

- [x] Review and approve each sub-plan before implementation starts.
- [x] Execute one plan at a time; do not overlap `A2` with `A3+`.
- [x] Request code review at the end of each plan, not only at the end of Track A.
- [x] Run targeted tests during each task and a focused validation pass before tagging each checkpoint.

## Hard Rules For Every Sub-Plan

- [x] No claim of improved recall without a runtime or fixture-backed check.
- [x] No Codex desktop parity claim without explicit diagnostics coverage.
- [x] No hidden destructive cleanup.
- [x] No Claude Code regressions introduced casually.
- [x] Keep docs honest: shipped behavior and future behavior must stay separated.
