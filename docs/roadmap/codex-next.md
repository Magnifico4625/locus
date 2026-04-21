# Codex Next Roadmap

**Date:** 2026-04-16  
**Starting point:** `v3.3.0` released and marked stable  
**Primary focus:** make Locus actually trustworthy as persistent memory for Codex CLI and Codex desktop / extension surfaces, then reduce install friction and polish the product surface around that stronger memory core.

---

## Purpose

This document tracks the **next Codex-focused product work after `v3.3.0`**.

Unlike [codex.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex.md), which records the roadmap that shipped through the `v3.3.0` release, this file is forward-looking. It is intentionally organized as **product tracks**, not as one long linear phase chain.

---

## Planning Horizon

Current planning window:

- **Late April 2026** — memory trust gap closure, recall validation, and Codex-facing diagnostics
- **May 2026** — one-command install, desktop polish, and richer product UX around the stronger memory path
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
- New work should improve recall truthfulness, onboarding, or diagnosability before expanding surface area.

---

## Track A — Codex Memory Trust / Honest Recall

**Priority:** `P0`  
**Target window:** late April 2026 into May 2026  
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

- Codex CLI can reliably recover meaningful recent context from real sessions, not only structural metadata
- Codex desktop / extension surfaces can either recover the same context or report their limitation honestly and diagnosably
- repeated collaboration patterns become discoverable:
  - preferred workflow
  - accepted product direction
  - coding-style or review-style preferences
  - prior architecture decisions and why they were chosen
- README claims about persistent memory, recent dialogue, and cross-session continuity are true in normal validated Codex usage

### Release intent

Highest-priority candidate scope for the next Codex-focused release line, likely **`v3.4`** in whole or in part.

---

## Track B — One-Command Install For Codex

**Priority:** `P0`  
**Target window:** May 2026 and after the first memory-trust work lands  
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

### Key constraints

- canonical source of truth must stay in the main `locus` repository
- marketplace repo should be packaging/distribution only, not a second development home
- install UX must not break existing manual MCP users

### Success criteria

- a new Codex user can install Locus without cloning and building the repo manually
- plugin/runtime version alignment is documented and testable
- manual MCP remains a supported fallback, not a dead path

### Release intent

Candidate scope for **`v3.4.x`** once the first memory-trust fixes have landed.

---

## Track C — Richer Codex Conversational Recall

**Priority:** `P0`  
**Target window:** May 2026 and after the trust-gap work establishes the baseline  
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

Most likely **`v3.4.x` or `v3.5`**, depending on how much of the baseline trust work and packaging work land first.

---

## Track D — Codex Desktop / Extension Polish

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

## Track E — HTML Dashboard

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

## Track F — Secondary IDE Adapters

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

### Performance And Scale

- test larger Codex session histories
- keep auto-import bounded
- avoid turning richer recall into unacceptable search latency

---

## Suggested Release Shape

This is a planning suggestion, not a hard contract.

| Release | Primary intent |
|---------|----------------|
| `v3.4` | close the Codex memory trust gap: reliable auto-import, validated recall, automatic high-value memory persistence |
| `v3.4.x` | one-command install foundations: marketplace repo, packaged runtime, install UX cleanup |
| `v3.5` | richer Codex conversational recall (`redacted` / `full`) and stronger capture/privacy UX |
| `v4.0` | HTML dashboard + broader product-grade memory visibility |

Secondary IDE adapters should be scheduled only when they do not block the Codex-first path above.

---

## Immediate Next Candidates

1. Prove why the current validated Codex path still delivers weak real recall:
   - client detection
   - auto-import triggering
   - capture-mode usefulness
   - search quality on real sessions
2. Define the first trustworthy Codex default or recommended mode:
   - improved `metadata`
   - `redacted` by default
   - or another bounded selective-capture design
3. Design automatic high-value memory persistence for:
   - accepted decisions
   - user preferences
   - collaboration style
   - stable project constraints
4. Define the published runtime strategy for `npx` / packaged install.
5. Design the Codex marketplace repository as a thin distribution layer.
6. Decide whether the dashboard starts as read-only diagnostics or as a broader memory browser from day one.
