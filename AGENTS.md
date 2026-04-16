# AGENTS

This file defines the working contract for AI agents operating in the `locus` repository.

It is intentionally short, opinionated, and practical.

---

## Mission

Build and maintain Locus as a persistent memory platform for AI coding tools, with the current primary product focus on:

1. Codex CLI
2. Codex desktop / extension surfaces
3. Claude Code compatibility preservation

Secondary IDE adapters such as Cursor, Windsurf, Cline, and Zed matter, but they must not degrade the primary Codex path.

---

## Core Working Style

- Think before coding.
- Surface wrong assumptions, hidden confusion, and missed trade-offs early.
- Prefer simplicity first.
- Avoid unnecessary abstraction and speculative complexity.
- Make surgical changes.
- Do not touch unrelated code without a clear reason.
- Keep implementation goal-oriented.
- Use tests and checkable success criteria as a competitive advantage, not as an afterthought.

---

## Collaboration Contract

- Work task-by-task when the user is driving an execution sequence.
- Do not silently jump to the next major task if the user asked for approval gates.
- Communicate directly and concisely.
- Prefer facts, validation results, and concrete trade-offs over reassurance or filler.
- Save important project decisions so they remain discoverable across sessions.

---

## Product Rules

### 1. Keep one Locus, not separate products

- Do not fork Locus into separate products for Codex, Claude Code, or other clients.
- Reuse the shared storage, inbox, search, and ingest pipeline wherever possible.
- Client-specific behavior should be implemented as thin adapters.

### 2. Codex is the current primary product line

- Codex CLI and Codex desktop / extension are the primary validation path after `v3.3.0`.
- Codex-first work should improve one or more of:
  - installation UX
  - conversational recall quality
  - diagnostics
  - packaging
  - user trust and privacy clarity

### 3. Claude Code must not regress casually

- `packages/claude-code/**` should stay untouched unless a shared contract change truly requires it.
- Codex work must not create incidental Claude regressions.

### 4. Secondary IDE support is real but lower priority

- Cursor, Windsurf, Cline, Zed, and similar MCP clients are important.
- Treat them as secondary adapters, not as the driver of core architecture.
- Reuse the same ingest contracts and storage model instead of special-casing each IDE.

---

## Memory And Capture Rules

- Default to safe capture behavior unless the user explicitly wants richer recall.
- Be precise about what each mode means:
  - `metadata` = ingestion and diagnostics first, minimal content recall
  - `redacted` = practical richer recall with privacy filtering
  - `full` = maximum recall, explicit warning territory
- Never describe `full` as risk-free.
- Do not claim semantic recall quality without validating it against real session data.
- Separate “events imported successfully” from “conversation recall is meaningfully useful”.

---

## Documentation Rules

- Keep shipped state and future ideas clearly separated.
- Historical delivered roadmap belongs in `docs/roadmap/codex.md`.
- Forward-looking Codex work belongs in `docs/roadmap/codex-next.md`.
- README, roadmap, release notes, and install docs must tell the same product story.
- Do not leave stale “future work” text in shipped docs after a release.

---

## Git And Release Discipline

- Prefer local-first validation before GitHub push.
- Keep stable checkpoints and release markers explicit.
- Do not rewrite shared history without explicit approval.
- Prefer clean release flow:
  - validate locally
  - prepare docs and version metadata
  - push release branch
  - open PR
  - merge intentionally
  - tag stable release
- Preserve useful local history by archiving before destructive cleanup.

---

## Verification Rules

- Do not claim success without verification.
- Runtime claims require runtime checks.
- Installation claims require installation checks.
- Search/recall claims require real recall checks, not only unit tests.
- If a failure is environmental or upstream, say so explicitly and do not mislabel it as solved.

---

## Packaging Rules

- Keep canonical product logic in the main `locus` repository.
- Marketplace repositories or packaging repositories should be thin distribution layers, not second sources of truth.
- If “one-command install” is the goal, package the runtime as well as the plugin metadata.
- Keep manual MCP setup documented as a fallback until the packaged install path is fully proven.

---

## Immediate Strategic Priorities After v3.3.0

See [docs/roadmap/codex-next.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex-next.md), but in short:

1. One-command install for Codex
2. Richer Codex conversational recall
3. Codex desktop / extension polish
4. HTML dashboard
5. Secondary IDE adapters only after the Codex-first path is strong

---

## Agent Heuristic

When in doubt:

1. choose the simpler design
2. validate before claiming
3. protect shipped behavior
4. keep docs honest
5. favor Codex-first product progress without breaking the shared platform
