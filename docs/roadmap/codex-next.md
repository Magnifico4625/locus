# Codex Next Roadmap

**Date:** 2026-04-16  
**Last updated:** 2026-05-30
**Starting point:** `v3.3.0` released and marked stable  
**Primary focus:** Track A shipped publicly in `v3.4.0`. Track B is published to npm through `locus-memory@3.5.3`. Track C richer recall shipped in `v3.6.0`, with `v3.6.1` as a focused Codex installer hotfix that keeps one-command installs on `$CODEX_HOME/memory/`. Track D is prepared as `v3.7.0`: project isolation, temporal recall, freshness guarantees, ranking, and project-state summaries before dashboard work.

---

## Purpose

This document tracks the **next Codex-focused product work after `v3.3.0`**.

Unlike [codex.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex.md), which records the roadmap that shipped through the `v3.3.0` release, this file is forward-looking. It is intentionally organized as **product tracks**, not as one long linear phase chain.

---

## Planning Horizon

Current planning window:

- **Late April 2026** — memory trust gap closure, recall validation, Codex-facing diagnostics, and one-command install implementation
- **May 2026** — GitHub release publication, project-isolated recall, temporal/date-bucketed recall, Codex desktop validation, and stronger memory reliability
- **Later** — dashboard UX, secondary clients, and broader memory platform UX

---

## Priority Model

| Priority | Meaning |
|----------|---------|
| `P0` | Core Codex CLI / Codex desktop install, freshness, and memory reliability |
| `P1` | Important Codex improvements that deepen usefulness after install |
| `P2` | Secondary client support and ecosystem expansion |

Rules:

- Codex CLI and Codex desktop/extension remain the primary validation path.
- Cursor, Windsurf, and similar IDE clients remain important but secondary.
- New work should improve recall truthfulness, onboarding, or diagnosability before expanding surface area.
- Project-isolated and date-bucketed recall outrank dashboard/UI work until Locus memory is dependable enough to use as a trusted Codex work context.

---

## Track A — Codex Memory Trust / Honest Recall

**Priority:** `P0`  
**Target window:** late April 2026 into May 2026  
**Current status:** released publicly in `v3.4.0`; checkpoint tag `v3.4.0`.
**Why it matters:** the current product story is ahead of the lived Codex experience. `metadata` mode plus fragile Codex client detection can produce a system that is diagnostically alive but not yet useful as persistent conversational memory. Before scaling install, Locus needs to earn trust as actual memory.

### Goal

Make Codex users able to rely on Locus for meaningful project recall: recent dialogue, accepted decisions, user preferences, and working style should become recoverable in a way that matches the product story, not only the plumbing story.

### Target deliverables

- robust Codex client detection so auto-import reliably identifies real Codex CLI and desktop / extension launches
- auto-import behavior that actually triggers in the validated Codex paths instead of silently falling back to generic mode
- a practical recommended capture path beyond pure `metadata`, centered on `redacted` as the likely trust-preserving default for real recall
- automatic extraction and storage of high-value memories such as accepted architecture decisions, user preferences, and recurring collaboration style
- bounded automatic memory write-back during or after sessions, so important context is persisted without requiring the user to explicitly call `memory_remember`
- acceptance tests against real Codex session fixtures that prove meaningful recall, not only import counts, idempotency, or diagnostics
- docs and diagnostics that clearly distinguish:
  - imported events
  - searchable useful recall
  - intentionally filtered content

### Key constraints

- do not claim strong recall from `metadata` if the mode is still intentionally minimal
- keep token growth and local storage growth bounded; automatic summarization/extraction should be selective, not verbose transcript hoarding by default
- `full` remains explicitly opt-in and warning-heavy
- user trust matters more than the appearance of coverage; docs must describe what actually works in Codex CLI and desktop / extension
- Claude Code must not regress casually while Codex-first memory behavior improves

### Success criteria

- Codex CLI can reliably recover meaningful recent context from fixture-backed real-session flows, not only structural metadata
- Codex desktop / extension surfaces can either recover the same context or report their limitation honestly and diagnosably
- repeated collaboration patterns become discoverable:
  - preferred workflow
  - accepted product direction
  - coding-style or review-style preferences
  - prior architecture decisions and why they were chosen
- README claims about persistent memory, recent dialogue, and cross-session continuity are true in normal validated Codex usage

### Release intent

Shipped in **`v3.4.0`**.

### Delivered Locally

- `A1` Runtime Truth: completed and tagged `track-a-a1-local`
- `A2` Bounded Hybrid Capture: completed and tagged `track-a-a2-local`
- `A3` Local High-Value Extraction: completed and tagged `track-a-a3-local`
- `A4` Recall UX: completed and tagged `track-a-a4-local`
- `A5` Retention And Cleanup: completed and tagged `track-a-a5-local`
- `A6` Acceptance And Docs Truth Pass: completed and tagged `track-a-a6-local`

Validation evidence from `A6`:

- Track A focused test subset passed: `11` test files, `99` tests.
- Workspace typecheck passed for `@locus/core` and `@locus/codex`.
- Acceptance matrix added: [docs/codex-acceptance-matrix.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-acceptance-matrix.md).
- README, Codex docs, VS Code guide, roadmap, and Track A spec now describe `metadata`, `redacted`, `full`, Codex CLI validation, and desktop/extension parity honestly.

---

## Track B — One-Command Install For Codex

**Priority:** `P0`  
**Target window:** May 2026 and after the first memory-trust work lands  
**Current status:** completed and published to npm as `locus-memory@3.5.3`; registry-hosted `npx` install, local Codex config migration, `doctor codex`, `codex mcp get locus`, and raw MCP `initialize` are validated from `$CODEX_HOME`. `v3.5.1` writes a safe Codex MCP `cwd`, preventing Windows `npx` from resolving the local monorepo workspace when Codex is launched inside the Locus repository. `v3.5.2` fixes `doctor codex` ownership detection for the real `codex mcp get locus` path. `v3.5.3` aligns package version, README, release notes, tests, and GitHub Pages for the public one-command install story.
**Why it matters:** once the Codex memory path is trustworthy, the next major UX win is reducing installation from a repo-driven setup to a simple marketplace-based or package-driven flow.

### Goal

Make Locus installable for Codex users with the smallest possible setup burden, ideally through a marketplace-driven flow plus a packaged runtime.

### Target deliverables

- separate Codex marketplace repository as a thin distribution layer
- marketplace-based install path for Locus plugin discovery
- published runtime artifact so the plugin no longer depends on a local repo checkout
- npm package for one-command `npx` / packaged install flow
- migration guide from manual MCP setup to marketplace/package install
- documented fallback path when marketplace or extension behavior differs from Codex CLI
- `locus-memory install codex`, `doctor codex`, and `uninstall codex` CLI commands
- generated marketplace bundle under `dist/marketplace/` without mutating a second git repository

### Key constraints

- canonical source of truth must stay in the main `locus` repository
- marketplace repo should be packaging/distribution only, not a second development home
- install UX must not break existing manual MCP users

### Success criteria

- a new Codex user can install Locus without cloning and building the repo manually
- plugin/runtime version alignment is documented and testable
- manual MCP remains a supported fallback, not a dead path

### Release intent

Shipped as **`v3.5.0`** for npm and local Codex CLI install validation. Follow-up hotfix **`v3.5.1`** sets the recurring Codex MCP `cwd` to `$CODEX_HOME`; **`v3.5.2`** fixes package-owned doctor ownership detection; **`v3.5.3`** is the public one-command install release candidate for GitHub publication.

### Delivered

- public `locus-memory@3.5.0` npm package
- `locus-memory mcp`
- `locus-memory install codex`
- `locus-memory doctor codex`
- `locus-memory uninstall codex`
- pinned recurring MCP runtime: `npx.cmd -y locus-memory@3.5.0 mcp` on Windows
- `v3.5.1` recurring MCP config writes `cwd = "$CODEX_HOME"` so `npx` starts outside the Locus monorepo
- redacted capture defaults for installed Codex config
- safe install behavior: backups, lock, cleanup, idempotent skill install
- generated marketplace bundle under `dist/marketplace/`
- manual MCP fallback preserved in docs

Validation evidence:

- `npm publish` prepublish gate passed: typecheck, lint, `105` test files / `1098` tests, and build.
- `npm view locus-memory@3.5.0` confirmed registry metadata and `bin`.
- `npx -y locus-memory@3.5.0 --version` returned `3.5.0` from outside the monorepo.
- Disposable `CODEX_HOME` install created `config.toml` and `skills/locus-memory/SKILL.md`.
- Local Codex config was migrated to the package runtime and `codex mcp list/get locus` confirmed the entry.

Known follow-up:

- `doctor codex` can report `Ownership: missing` for migrated legacy/manual entries; runtime works, but a future migration can claim ownership explicitly.
- Codex desktop / extension parity remains unverified and must not be claimed until tested.

---

## Track C — Richer Codex Conversational Recall

**Priority:** `P0`  
**Target window:** May 2026 and after the trust-gap work establishes the baseline  
**Current status:** shipped in `v3.6.0`; `v3.6.1` hotfix ensures fresh one-command Codex installs pass `CODEX_HOME` into the generated MCP environment and use Codex storage instead of generic fallback storage.
**Why it matters:** once the product is no longer misleading at the baseline level, the next step is to deepen recall quality and make richer capture modes production-worthy rather than experimental.

### Goal

Turn Codex memory from “recent context is finally trustworthy” into “recent context is richly useful” while keeping privacy controls explicit and defensible.

### Target deliverables

- stronger `redacted` import path for usable dialogue recall
- optional `full` import path for maximum recall with clear warnings
- higher-quality extraction of persistent facts from dialogue:
  - accepted decisions
  - user preferences
  - collaboration style
  - recurring project constraints
- improved redaction guarantees and documented best-effort limits
- acceptance tests that prove recall quality, not only ingestion
- clearer capture-mode diagnostics in `memory_status`, `memory_doctor`, and docs
- explicit privacy/audit guidance for users switching away from `metadata`

### Key constraints

- do not force `metadata` to remain the default if it keeps undermining the core memory promise; choose the default based on validated trust and usefulness
- `full` must be treated as opt-in with visible warnings
- semantic recall quality should be measured against real Codex session fixtures, not only synthetic cases

### Success criteria

- `redacted` becomes the practical “recommended rich recall” mode
- `full` is available for users who explicitly prefer maximum memory over stricter privacy
- users can understand what is stored and why, without reading source code

### Release intent

Shipped as **`v3.6.0`** with a focused **`v3.6.1`** installer hotfix.

### Delivered locally

- C1 Recall Engine v2: query parsing, temporal hints, candidate loading, scoring, grouping, and `candidateGroups`
- C2 Redacted Capture v2: bounded high-value snippets and stronger redaction tests
- C3 Durable Extractor v2: topic keys, rejected alternatives, next steps, validation facts, user style/preferences, and supersede semantics
- C4 Inspectability: `memory_review`, `memory_audit`, evidence formatting, and storage visibility
- C5 Optional Codex Hooks: CLI hook helper and diagnostics; plugin hook packaging deferred until upstream `plugin_hooks` stabilizes
- C6 Acceptance And Docs: Track C fixture-backed recall acceptance completed for the core path; public docs truth pass and final validation still gate release publication

---

## Track D — Codex Memory Reliability / Temporal Recall

**Priority:** `P0`

**Target window:** `v3.7.0` Codex-first memory reliability release

**Current status:** locally validated for `v3.7.0`. D0-D8 completed with project-scoped temporal recall, `memory_calendar`, freshness/surface diagnostics, `memory_project_state`, same-topic next-step supersession, JSONL fixture acceptance, docs truth pass, full repository `npm run check`, and `npm run build`. Live Desktop smoke confirmed the configured `locus` MCP server points at this repo's `dist/server.js`, while the already-running Desktop session still exposed the previous tool registry until MCP/Desktop reload.

**Why it matters:** richer recall is only useful if it returns the right project, the right time period, and the current state without forcing the agent to manually filter unrelated memories. Locus should feel like a reliable project memory, not a broad search over old conversations.

### Goal

Make Locus dependable enough for Codex agents to use as their default project-memory source: fresh, project-scoped, date-aware, well-ranked, inspectable, and resistant to stale or cross-project noise.

### Target deliverables

- strict project isolation for recall:
  - `projectRoot`
  - git root / project hash
  - source session
  - client surface
  - topic namespace
- temporal recall index:
  - store event timestamps separately from import timestamps
  - derive `localDate`, week, and month buckets
  - support queries such as "today", "yesterday", "this week", "this month", and named months
  - expose which date buckets were searched
- calendar-style discovery tool or mode:
  - show which days/weeks/months have memories for the current project
  - summarize sessions and topic keys per date bucket
  - let the agent narrow recall before inspecting full candidates
- freshness guarantee before recall:
  - unified import truth snapshot for CLI and desktop
  - latest rollout path, latest imported timestamp, imported-count delta, and surface detection
  - remove or explain mismatches between auto-import and diagnostics snapshots
- Codex Desktop as a first-class validated surface:
  - detect and report desktop separately from CLI when possible
  - validate desktop session import, recall, and freshness with a real marker test
  - update diagnostics/docs from "unverified" to the strongest statement supported by evidence
- recall ranking v3:
  - project match before generic similarity
  - exact entities and file paths before broad semantic terms
  - durable active decisions before stale or superseded memories
  - recency and time-range fit as explicit scoring factors
- automatic project-state summaries:
  - current version, branch/tag, shipped tracks, known warnings, next debt, and validation status
  - refreshable from repo evidence instead of relying only on old memory
- decision lifecycle improvements:
  - active / stale / superseded / historical states stay accurate
  - old blockers become superseded when later validation or release work resolves them
- better evidence anchors:
  - commit, file, doc section, command result, timestamp, and session id where available
  - enough evidence for the agent to verify memory quickly before making claims
- noise control:
  - persist high-value decisions, preferences, rejected alternatives, validation facts, and next steps
  - avoid treating every transient exchange as durable project memory
- project-state verification command:
  - compare memory summaries with `git status`, package metadata, release notes, and roadmap docs
  - flag stale memories instead of silently mixing them into current answers

Implementation note:

- Track D project-scoped recall isolates durable topic keys by `projectRoot`; the same `topic_key` may exist in two projects without leaking across recall/search/timeline results. A separate user-configurable topic namespace filter remains a follow-up if acceptance testing shows a real need beyond project-root isolation.
- `memory_calendar` is the recommended first tool for broad period questions. It defaults to `last_30d`, so agents should pass `this_month`, `last_month`, or an explicit range for user period questions instead of relying on the default.
- Date-scoped `memory_recall` reports searched date buckets, and current-project recall must not mix other project memories unless the user explicitly asks for global recall.
- Codex Desktop marker/config behavior is validated when `LOCUS_CODEX_SURFACE=desktop` and Track D marker acceptance passes; fresh live visibility of newly added tools still requires a Desktop/MCP reload smoke, and `LOCUS_CODEX_SURFACE` remains a diagnostic/debug override that can mislead diagnostics if left set accidentally.
- Evidence anchors remain a follow-up: candidates expose source event IDs, durable IDs, project roots, and date metadata now; richer display formatting for commits, files, docs, command results, and timestamps can ship after project-scoped behavior is proven.

### Key constraints

- do not solve recall quality by storing unlimited transcript text
- do not let cross-project memories leak into a current-project answer unless the user asks for global recall
- do not use import time as the source event date
- keep date/time behavior explicit about timezone and absolute dates
- keep all deletion or cleanup user-controlled and inspectable
- Claude Code compatibility must not regress while Codex recall gets stricter

### Success criteria

- "вспомни работу в этом месяце" checks only memories from the resolved month and current project, then reports which date buckets were used
- a Locus project recall question does not return ProxyVpn or other unrelated project memories without an explicit global query
- `memory_status` and doctor output agree on current client/surface, latest import, and recall readiness
- Codex Desktop can pass a real session marker test: create marker, import/auto-import, restart, recall marker, and report desktop evidence
- stale release blockers and resolved tasks no longer appear as current next steps
- an agent can answer "what is the current state of this project?" from Locus plus quick repo verification with minimal manual reconstruction

### Release intent

Best treated as the `v3.7.0` Codex-first release before HTML dashboard work. Follow-up `v3.7.x` slices should focus on richer evidence-anchor display, explicit topic namespace filters only if project-root isolation proves insufficient, and stronger live Desktop reload validation.

---

## Track E — Codex Desktop / Extension Polish

**Priority:** `P1`  
**Target window:** late April 2026 through May 2026  
**Why it matters:** installation and diagnosis need to feel coherent not only in CLI, but also in Codex desktop / extension surfaces where upstream MCP behavior may still vary.

### Goal

Reduce friction and confusion for Codex users outside the pure CLI path, without pretending Locus controls upstream extension behavior.

### Target deliverables

- marketplace-aware desktop/extension install docs
- clearer diagnosis flow for “plugin visible but MCP not active” situations
- stable guidance for restart/reload behavior
- explicit compatibility matrix: CLI, desktop/extension, manual MCP fallback
- cleaner first-run workflow through skill/plugin instructions

### Success criteria

- support questions about Codex desktop/extension can be answered from docs and diagnostics
- users know exactly when a limitation belongs to Locus and when it belongs to upstream Codex surfaces

### Release intent

Can land incrementally after the `v3.5.0` release publication work, without claiming parity before direct validation.

---

## Track F — HTML Dashboard

**Priority:** `P1`  
**Target window:** after the memory reliability track

**Why it matters:** as memory grows, CLI-only inspection becomes less approachable. A local dashboard can make memory health, imports, and recall visibly understandable.

### Goal

Provide a local HTML dashboard that helps users inspect memory state, imported conversations, recent events, and storage health without raw SQL or repeated CLI tool calls.

### Target deliverables

- local dashboard entrypoint
- overview cards for memory counts, Codex import health, and recent scans/imports
- conversation/event inspection UI
- capture-mode and privacy visibility
- import diagnostics and doctor-style warnings surfaced visually
- clean, attractive UI that makes Locus feel like a product, not only an MCP server

### Nice-to-have later

- searchable timeline view
- session drill-down
- filters by client, project, capture mode, and event kind

### Success criteria

- users can understand “what Locus knows” without using internal tools directly
- dashboard becomes the easiest support and debugging surface for memory issues

### Release intent

Likely **`v4.0`** scope unless a smaller read-only dashboard ships earlier.

---

## Track G — Secondary IDE Adapters

**Priority:** `P2`  
**Target window:** after Codex memory reliability and dashboard scoping

**Why it matters:** Locus should remain a memory platform, not only a Codex integration. But these adapters should not slow down the primary Codex roadmap.

### Goal

Extend passive memory capture beyond Codex and Claude Code into other IDE ecosystems through thin adapter packages.

### Target deliverables

- `@locus/log-tailer` for Cursor / Windsurf style log-based or file-based capture
- adapter contract for non-Codex clients
- docs for setup and limitations per IDE
- ingestion compatibility with the same inbox/database pipeline

### Key constraints

- do not fork core storage/search logic for each IDE
- secondary adapters must stay thin and reuse the existing ingest contracts
- Codex remains the primary client for acceptance and release prioritization

### Success criteria

- Cursor/Windsurf support becomes real enough to document as an adapter, not only as generic MCP compatibility
- IDE-specific capture behavior is explicit and diagnosable

### Release intent

Best treated as **post-`v3.5`** work unless richer Codex recall and dashboard work land faster than expected.

---

## Cross-Cutting Work

These are not separate releases, but they should shape every major track above.

### Packaging Discipline

- keep plugin, marketplace, and published runtime versions aligned
- automate bundle sync where practical
- make release notes clearly describe install path changes

### Privacy And Audit UX

- improve visibility of what `metadata`, `redacted`, and `full` actually store
- keep audit output understandable for non-experts
- avoid making “full memory” feel magical or risk-free

### Memory Write Discipline

- automatically persist only high-value facts, not every transient exchange
- keep preference/style capture selective and revisable
- ensure automatic memory writes remain inspectable and diagnosable by the user
- prevent uncontrolled token/storage growth from naive dialogue capture

### Upgrade And Migration Paths

- document how manual MCP users move to marketplace/package install
- keep rollback paths simple
- preserve stable local storage layouts across install methods

### Acceptance Matrix

Maintain an explicit validation matrix for:

- Codex CLI
- Codex desktop / extension
- manual MCP fallback
- secondary IDE adapters when they exist

Current matrix: [docs/codex-acceptance-matrix.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-acceptance-matrix.md).

### Performance And Scale

- test larger Codex session histories
- keep auto-import bounded
- avoid turning richer recall into unacceptable search latency

---

## Suggested Release Shape

This is a planning suggestion, not a hard contract.

| Release | Primary intent |
|---------|----------------|
| `v3.4` | shipped Track A memory-trust work: reliable auto-import, validated recall, automatic high-value memory persistence, honest diagnostics/docs |
| `v3.5` | shipped one-command install foundations: npm runtime, installer/doctor/uninstall, marketplace bundle generation, install UX cleanup |
| `v3.6.0` | Track C richer Codex conversational recall (`redacted` / `full`) and stronger capture/privacy UX |
| `v3.6.1` | Codex one-command install hotfix: generated MCP env includes `CODEX_HOME`, keeping storage under `$CODEX_HOME/memory/` |
| `v3.7.0` | Codex memory reliability: project isolation, temporal recall, freshness, ranking, project-state summaries, and Codex Desktop validation evidence |
| `v4.0` | HTML dashboard + broader product-grade memory visibility after recall is dependable |

Secondary IDE adapters should be scheduled only when they do not block the Codex-first path above.

---

## Immediate Next Candidates

1. Prepare the `v3.7.0` release path:
   - local `npm pack` smoke is complete: `locus-memory-3.7.0.tgz` contains the intended runtime files, plugin manifest, skill, config, docs, and `3.7.0` metadata
   - local tarball `install codex --yes` smoke is complete with `LOCUS_CODEX_RUNTIME_PACKAGE=<tgz>` and isolated `CODEX_HOME`
   - post-publish registry smoke is complete: `npx --yes locus-memory@3.7.0 --version` returned `3.7.0`, `install codex --yes` completed, and `codex mcp get locus` points at `npx.cmd -y locus-memory@3.7.0 mcp`
   - verify `codex mcp get locus` from the intended long-lived Codex CLI/Desktop environment after reload
   - reload Desktop and confirm the live registry exposes `memory_calendar` and `memory_project_state`
2. Improve Track D follow-ups without broadening the release claim:
   - richer evidence-anchor display for commits, files, docs, command results, timestamps, and sessions
   - user-configurable topic namespace filters only if project-root isolation proves insufficient
   - broader stale or historical lifecycle automation after project-scoped durable state has more mileage
3. Revisit dashboard scope after the memory reliability track is demonstrably better in a reloaded Desktop session.
