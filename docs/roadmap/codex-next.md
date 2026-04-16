# Codex Next Roadmap

**Date:** 2026-04-16  
**Starting point:** `v3.3.0` released and marked stable  
**Primary focus:** make Locus easier to install, more useful for real Codex conversation recall, and more diagnosable in Codex CLI and Codex desktop/extension surfaces.

---

## Purpose

This document tracks the **next Codex-focused product work after `v3.3.0`**.

Unlike [codex.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex.md), which records the roadmap that shipped through the `v3.3.0` release, this file is forward-looking. It is intentionally organized as **product tracks**, not as one long linear phase chain.

---

## Planning Horizon

Current planning window:

- **Late April 2026** — packaging, install UX, and Codex-facing polish
- **May 2026** — richer recall, dashboard foundations, and broader adapter groundwork
- **Later** — secondary clients and broader memory platform UX

---

## Priority Model

| Priority | Meaning |
|----------|---------|
| `P0` | Core Codex CLI / Codex desktop install and memory UX |
| `P1` | Important Codex improvements that deepen usefulness after install |
| `P2` | Secondary client support and ecosystem expansion |

Rules:

- Codex CLI and Codex desktop/extension remain the primary validation path.
- Cursor, Windsurf, and similar IDE clients remain important but secondary.
- New work should improve onboarding, recall quality, or diagnosability before expanding surface area.

---

## Track A — One-Command Install For Codex

**Priority:** `P0`  
**Target window:** late April 2026 into May 2026  
**Why it matters:** `v3.3.0` proved the Codex product line. The next major UX win is reducing installation from a repo-driven setup to a simple marketplace-based flow.

### Goal

Make Locus installable for Codex users with the smallest possible setup burden, ideally through a marketplace-driven flow plus a packaged runtime.

### Target deliverables

- separate Codex marketplace repository as a thin distribution layer
- marketplace-based install path for Locus plugin discovery
- published runtime artifact so the plugin no longer depends on a local repo checkout
- npm package for `npx` / packaged install flow
- migration guide from manual MCP setup to marketplace/package install
- documented fallback path when marketplace or extension behavior differs from Codex CLI

### Key constraints

- canonical source of truth must stay in the main `locus` repository
- marketplace repo should be packaging/distribution only, not a second development home
- install UX must not break existing manual MCP users

### Success criteria

- a new Codex user can install Locus without cloning and building the repo manually
- plugin/runtime version alignment is documented and testable
- manual MCP remains a supported fallback, not a dead path

### Release intent

Candidate scope for **`v3.4`** if packaged runtime and marketplace flow are both solid.

---

## Track B — Richer Codex Conversational Recall

**Priority:** `P0`  
**Target window:** May 2026  
**Why it matters:** current `metadata` mode validates ingestion and idempotency, but does not yet deliver strong semantic recall of real Codex dialogue.

### Goal

Turn Codex memory from “events were imported” into “recent conversation context can be recalled meaningfully” while keeping privacy controls explicit and defensible.

### Target deliverables

- stronger `redacted` import path for usable dialogue recall
- optional `full` import path for maximum recall with clear warnings
- improved redaction guarantees and documented best-effort limits
- acceptance tests that prove recall quality, not only ingestion
- clearer capture-mode diagnostics in `memory_status`, `memory_doctor`, and docs
- explicit privacy/audit guidance for users switching away from `metadata`

### Key constraints

- `metadata` should remain the default safe mode until richer capture has proven privacy and UX discipline
- `full` must be treated as opt-in with visible warnings
- semantic recall quality should be measured against real Codex session fixtures, not only synthetic cases

### Success criteria

- `redacted` becomes the practical “recommended rich recall” mode
- `full` is available for users who explicitly prefer maximum memory over stricter privacy
- users can understand what is stored and why, without reading source code

### Release intent

Most likely **`v3.4.x` or `v3.5`**, depending on how much packaging work lands first.

---

## Track C — Codex Desktop / Extension Polish

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

Can land incrementally alongside `v3.4`.

---

## Track D — HTML Dashboard

**Priority:** `P1`  
**Target window:** May 2026 and later  
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

## Track E — Secondary IDE Adapters

**Priority:** `P2`  
**Target window:** May 2026 and later  
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

Best treated as **post-`v3.4` / `v3.5`** work unless packaging and richer recall land faster than expected.

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

### Performance And Scale

- test larger Codex session histories
- keep auto-import bounded
- avoid turning richer recall into unacceptable search latency

---

## Suggested Release Shape

This is a planning suggestion, not a hard contract.

| Release | Primary intent |
|---------|----------------|
| `v3.4` | one-command install foundations: marketplace repo, packaged runtime, install UX cleanup |
| `v3.5` | richer Codex conversational recall (`redacted` / `full`) and stronger capture/privacy UX |
| `v4.0` | HTML dashboard + broader product-grade memory visibility |

Secondary IDE adapters should be scheduled only when they do not block the Codex-first path above.

---

## Immediate Next Candidates

1. Design the Codex marketplace repository as a thin distribution layer.
2. Define the published runtime strategy for `npx` / packaged install.
3. Choose the target behavior for `redacted` as the likely “recommended rich recall” mode.
4. Decide whether the dashboard starts as read-only diagnostics or as a broader memory browser from day one.
