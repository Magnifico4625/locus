# Track A: Codex Memory Trust / Honest Recall Design

**Date:** 2026-04-21  
**Status:** approved product design baseline; A1-A6 implementation is in local validation  
**Primary users:** Codex CLI users first, Codex desktop / extension users second  
**Primary problem:** Locus currently proves Codex ingest plumbing and structural memory, but does not yet reliably deliver the product promise of useful cross-session Codex memory.

---

## Purpose

This document defines the **product contract and architecture boundaries** for `Track A` in [docs/roadmap/codex-next.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex-next.md).

The goal of Track A is not "make memory bigger." The goal is to make Locus **truthfully useful as persistent memory** for real Codex work:

- recent dialogue should be recoverable when it matters
- accepted decisions should not disappear between sessions
- user preferences and collaboration style should become discoverable
- the user should stay in control of what automatic memory does

This is the **master design** for Track A. It intentionally does not specify exact implementation steps or exact file edits. Those belong in the follow-up implementation plans.

Current validation artifact: [docs/codex-acceptance-matrix.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/codex-acceptance-matrix.md).

---

## Problem Statement

As of `v3.3.0`, the product story is ahead of the lived Codex experience.

The current system already provides real value in three areas:

- structural project memory
- manually saved semantic memory through `memory_remember`
- Codex diagnostics and bounded import plumbing

However, it still falls short in the exact place users most naturally expect "memory":

- recent Codex dialogue is not reliably recoverable in useful form
- `metadata` mode is safe, but too weak to satisfy the practical memory promise
- automatic memory is not yet strong enough to preserve decisions, preferences, and working style without frequent manual help
- diagnostics can be green while the user experience still feels memory-poor

This gap creates a trust problem. Users do not judge memory by whether events were imported. They judge it by whether the agent can later answer:

- "What did we do yesterday?"
- "Why did we choose this approach?"
- "What do I usually prefer?"
- "What problem were we solving last week?"

---

## Design Goals

Track A must deliver the following:

1. **Truthful Codex memory**
   Locus must recall useful context in real Codex usage, not only prove ingest plumbing.

2. **Codex CLI as the hard acceptance gate**
   Codex CLI is the primary validated runtime. Codex desktop / extension must follow the same model where possible, but CLI is the first hard gate.

3. **Bounded hybrid memory**
   Locus should store:
   - durable high-value facts
   - short, relevant, redacted working-context snippets
   It should not become a transcript dump.

4. **Low write-path cost**
   Automatic write-path behavior should remain local and rule-based, with no model-token cost required to capture and classify useful memory.

5. **Summary-first recall UX**
   Users should be able to ask natural questions like "what did we do yesterday?" and get a concise answer first.

6. **Minimal Viable Agency**
   Automatic memory does not need to be perfect on day one, but it must be:
   - visible
   - explainable
   - reversible

7. **Docs truthfulness**
   README and install docs must only promise behavior that passes real Codex acceptance checks.

---

## Non-Goals

Track A does **not** try to deliver the following in its first release wave:

- perfect memory extraction from all dialogue
- full transcript retention by default
- silent autonomous cleanup or archival
- a broad visual dashboard
- secondary IDE adapter expansion
- major Claude Code product changes unrelated to shared memory contracts

---

## Product Principles

### 1. Keep one Locus

Track A improves the shared memory platform. It must not fork Locus into separate products for Codex and Claude Code. Client-specific behavior remains adapter-thin where possible.

### 2. Memory must be useful, not merely present

Imported events are not the same thing as useful recall. The design must separate:

- event ingestion success
- searchable memory availability
- meaningful user-facing recall

### 3. Bounded hybrid is the correct default design direction

The product should not choose between "facts only" and "store lots of dialogue."

The right shape is:

- **Durable memory** for decisions, preferences, style, and constraints
- **Recent working context** for short, relevant, redacted snippets from problem-solving dialogue

### 4. Write path stays local and deterministic

Track A should begin with:

- local capture
- local filtering
- local extraction
- local dedup / merge / supersede logic

No model-assisted summarization on the write path in v1.

### 5. Recall must feel natural

Users should not need to manually orchestrate memory tools. The agent should be able to interpret temporal questions and run the right tools on the user's behalf.

### 6. Automatic memory is assistive, not authoritative

The system can auto-extract and auto-suggest, but the user remains in control.

---

## Memory Model

Track A defines two main memory layers for Codex recall.

### Durable Memory

Durable memory stores stable, high-value facts that should survive beyond a single debugging thread or implementation burst.

Examples:

- architecture decisions
- user preferences
- collaboration style
- project constraints
- decisions that supersede older decisions

Durable memory must be:

- inspectable
- deduplicated
- revisable
- searchable over time

Durable memory should also carry a **Topic Key** whenever a fact belongs to a known decision or preference family.

Examples:

- `database_choice`
- `auth_strategy`
- `testing_policy`
- `coding_style`

Topic Keys are the anchor that allow newer memory to supersede older memory intentionally instead of accumulating as disconnected facts.

### Recent Working Context

Recent working context stores **short redacted snippets** of useful task dialogue and problem-solving context.

Examples:

- what problem was being solved
- what hypothesis was rejected
- what next step was agreed
- which alternative was selected and why

Recent working context must be:

- bounded
- recent-biased
- relevance-filtered
- separate from durable memory

It is intentionally **not** a full transcript.

---

## What Should Be Stored

Track A should automatically keep memory only for project-relevant content.

### Should be stored

- accepted decisions
- explicit user preferences
- recurring collaboration preferences
- recurring coding/review style preferences
- stable project constraints
- short problem-solving context that supports later recall
- agreed next steps when they remain relevant beyond the immediate turn

### Should usually be filtered out

- casual chatter
- off-topic questions
- general learning questions unrelated to the project
- repetitive low-signal planning chatter
- large raw dialogue chunks without retrieval value

---

## Runtime Contract

### Codex CLI

Codex CLI is the primary acceptance surface.

Track A is not complete unless Codex CLI can reliably answer recall-oriented questions using real session memory, not only structural memory or manually remembered facts.

Track A must also define a **normalization layer** for Codex runtime paths and runtime identity inputs.

At minimum, the runtime truth path should normalize:

- `CODEX_HOME`
- project roots
- session file paths
- metadata paths used for dedup, hashing, or diagnostics

The normalization contract should be stable across Windows and Unix-style environments.

Baseline rules:

- convert backslashes to forward slashes
- normalize drive letters consistently
- avoid treating logically identical paths as different locations

This matters because memory trust collapses quickly if the same project is observed as multiple identities depending on runtime surface or operating system.

### Codex Desktop / Extension

Codex desktop / extension should share the same configuration and the same memory model where possible.

But Track A should treat it as:

- a second validated layer
- best-effort parity with CLI
- honest diagnostics when upstream behavior differs

Track A must not falsely claim full parity until runtime checks prove it.

---

## Recall UX Contract

The user should be able to ask memory questions naturally.

Examples:

- "What did we do yesterday?"
- "What did we decide about auth last week?"
- "What were we fixing five days ago?"

The expected UX:

1. The agent automatically invokes the right memory tools.
2. The first response is a short summary.
3. If multiple tasks match, the agent asks a clarifying question.
4. Relative dates are clarified with absolute dates.

Example:

- "Yesterday" becomes "April 20, 2026"

The user should not be required to explicitly run:

- `memory_search`
- `memory_timeline`
- `memory_import_codex`

for normal recall flows.

This UX contract also requires **skill and prompt wiring**, not only better tools.

Track A must update the Codex-side memory skill and related instructions so that recall behavior becomes explicit and repeatable.

At minimum, the agent guidance should encode:

- if the user asks about prior work, check Locus before claiming not to remember
- prefer `memory_search` first for recall-oriented questions
- use `memory_timeline` when temporal sequencing matters
- use date filters or absolute-date clarification when the user asks about relative dates
- ask a clarifying question only after memory lookup returns multiple plausible tasks

Without this wiring, Recall UX remains an aspiration rather than a reliable product behavior.

---

## Minimal Viable Agency

Automatic memory is acceptable in v1 only if the user can understand and control it.

Track A therefore requires:

- visibility into what was automatically stored
- the ability to understand why it was stored
- fast removal or cleanup on request
- no silent destructive automation

The system does **not** need to be perfectly accurate from day one. But it must be:

- transparent
- debuggable
- reversible

Working product statement:

> Locus may not extract every useful memory perfectly from day one, but it must always make automatic memory visible, explainable, and easy to remove.

---

## Inspectability Contract

Every automatically extracted memory should be explainable enough for the user to trust or reject it.

At minimum, the system should make it possible to understand:

- what was stored
- what kind of memory it is
- when it was created
- whether it is still active or has been superseded
- why it was considered important enough to keep

Track A does not require a sophisticated visual UI for this. CLI/MCP-level visibility is sufficient in the first phase.

---

## Conflict And Change Semantics

Memory that cannot change safely becomes misleading over time.

Track A must define a model for:

- replacing old decisions with newer ones
- updating user preferences
- marking outdated constraints
- distinguishing repeated confirmation from genuinely new information

At minimum, the system should support the concepts:

- `active`
- `stale`
- `superseded`
- `archivable`

These states apply both to durable memory and to recent working context where appropriate.

For durable memory, `superseded` should not rely only on fuzzy similarity.

Track A should prefer:

- explicit Topic Keys where available
- deterministic conflict rules within the same Topic Key
- clear replacement semantics when a newer decision displaces an older one

Without this anchor, "we switched from PostgreSQL to SQLite" becomes two unrelated memories instead of one superseding the other.

---

## Retention And Cleanup Contract

Storage growth must be controlled without turning cleanup into dangerous hidden automation.

Track A therefore uses the following policy:

- no automatic destructive cleanup in v1
- no silent archival in v1
- stale or superseded memory may be marked, but not silently removed
- the agent may suggest cleanup when enough evidence exists

Cleanup suggestions should be based on explicit signals such as:

- the memory was superseded
- the memory duplicates another stronger memory
- the context has aged out and no longer improves recall
- the information is already better preserved in docs or git history

The system should prefer:

- suggest cleanup
- suggest compact
- suggest archive

before any destructive action.

---

## Token, Storage, And Budget Model

Track A should distinguish three cost paths.

### Write path

Goal: effectively zero model-token cost.

This path should stay local and deterministic:

- capture
- redaction
- filtering
- extraction
- dedup / merge
- storage

### Storage path

Goal: bounded local growth.

This path is limited by:

- bounded working-context windows
- durable-memory dedup
- stale / superseded markers
- user-guided cleanup

### Recall path

Goal: spend tokens only when memory is actively used.

This path may consume model context because the agent must:

- retrieve memory
- read it
- summarize it
- answer the user

This is acceptable. The design goal is not zero token usage everywhere; it is **token usage only where memory is actually being read**.

---

## Diagnostics And Truthfulness

Track A requires diagnostics to describe real memory usefulness, not just infrastructure health.

Diagnostics should make it clear when:

- import happened but recall is weak
- capture mode is too restrictive
- client detection failed
- a desktop / extension surface is behind CLI
- the memory available is incomplete

The system should explicitly avoid green-check false confidence.

Track A implementation exposes this distinction through:

- `memory_status.codexTruth`
- `memory_doctor` capture-mode warnings
- `memory_doctor` desktop/extension parity warnings

The validated product statement is: Codex CLI is the primary acceptance path; `redacted` is the practical recall mode; `metadata` is limited recall; desktop/extension parity remains unverified until checked in that runtime surface.

---

## Success Metrics

Track A needs product metrics, not only engineering metrics.

At minimum, success should be judged by:

- recall helpfulness on real Codex sessions
- low noise rate in automatic memory writes
- low contradiction rate in durable memory
- low false-positive rate for extracted preferences or decisions
- temporal recall that works without manual tool orchestration in common cases
- user trust: the system should feel controllable, not hidden

---

## Decomposition

Track A is too large for a single implementation plan. It must be decomposed.

### A1 — Codex Runtime Truth

Scope:

- client detection
- auto-import triggering
- Codex CLI truth path
- desktop / extension parity diagnostics
- cross-platform path normalization for runtime identity and project/session metadata

### A2 — Bounded Hybrid Capture

Scope:

- capture policy redesign
- relevant vs noisy dialogue filtering
- redacted snippet boundaries
- bounds for recent working context

### A3 — Local High-Value Extraction

Scope:

- rule-based extraction of:
  - decisions
  - preferences
  - style
  - constraints
- Topic Key generation for durable memory families
- dedup
- merge
- supersede rules

### A4 — Recall UX

Scope:

- temporal recall
- summary-first responses
- automatic tool orchestration
- clarification flow for multiple candidate tasks
- skill / prompt updates so the agent checks Locus before saying it does not remember

### A5 — Retention And Cleanup

Scope:

- stale / superseded / archivable marking
- storage hygiene suggestions
- no autonomous destructive cleanup
- Topic Key-aware supersede and cleanup semantics for durable memory

### A6 — Acceptance And Docs Truth Pass

Scope:

- real Codex session fixtures
- CLI acceptance matrix
- desktop / extension truth matrix
- README / docs / doctor / status truth alignment

---

## Recommended Execution Order

The execution order should be:

1. `A1 Runtime Truth`
2. `A2 Bounded Hybrid Capture`
3. `A3 Local High-Value Extraction`
4. `A4 Recall UX`
5. `A5 Retention And Cleanup`
6. `A6 Acceptance And Docs Truth Pass`

This order protects product truth:

- no strong recall on top of weak runtime truth
- no extraction policy before capture policy
- no polished UX before the memory substrate is real
- docs truth pass only after behavior is validated

---

## Key Risks

1. **False memory confidence**
   Green diagnostics may still hide weak recall unless usefulness becomes a first-class acceptance target.

2. **Memory bloat**
   If bounded hybrid becomes undisciplined, storage and retrieval quality both degrade.

3. **Contradictory durable memory**
   Without supersession logic, memory becomes less trustworthy over time.

4. **Over-promising desktop parity**
   The product must not claim runtime equality between CLI and desktop / extension unless proven.

5. **Destructive automation risk**
   Cleanup without explicit user control will destroy trust faster than imperfect extraction.

---

## Final Product Direction

Track A should make Locus feel like:

- a persistent memory system for real Codex work
- not just a searchable repo index
- not just an import pipeline
- not just a transcript hoarder

The right v1 promise is:

- useful memory
- bounded memory
- inspectable memory
- user-controlled memory
- truthful memory

That is the standard the follow-up implementation plans must serve.
