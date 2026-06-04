---
name: locus-memory
description: >
  Use when the user needs persistent project memory across sessions.
  Triggers on: "remember this", "what did we decide about...",
  "show project structure", "what changed recently", "search memory".
  Do NOT trigger for: ephemeral questions, one-off lookups,
  file reads that don't need memory.
---

# Locus -- Persistent Project Memory

You have access to Locus memory tools via MCP. Use them to maintain
project context across sessions.

## Core Tools

1. **memory_recall** -- Summary-first recall for past-work questions
2. **memory_calendar** -- Discover day/week/month activity buckets by project and time range
3. **memory_search** -- FTS5 search across all memory layers
4. **memory_remember** -- Save architecture decisions with auto-redaction
5. **memory_explore** -- Navigate the project file tree
6. **memory_timeline** -- View recent conversation history
7. **memory_status** -- Memory health and storage info
8. **memory_scan** -- Re-index project structure after file changes
9. **memory_review** -- Inspect durable memories, states, confidence, and evidence

## Key Behaviors

- Always check Locus before saying you do not remember prior work or prior decisions
- Use `memory_recall` first for questions about past work, prior decisions, or recent progress such as:
  - "what did we do yesterday?"
  - "what did we decide about auth?"
  - "what did we just fix?"
- Use `memory_calendar` for broad period discovery such as "what did we work on this month?" or "show May work" before drilling into specific days, weeks, or topics
- In Codex, recent dialogue is auto-imported before `memory_recall`, `memory_search`, and `memory_calendar`
- If `memory_recall` returns `needs_clarification`, inspect `candidateGroups` and ask a focused follow-up question after the lookup instead of guessing or asking before checking Locus
- If `memory_recall` returns `no_memory`, then fall back to `memory_search`, `memory_calendar`, or `memory_timeline` only when raw search, broad period discovery, or chronology is still useful
- If recent Codex history does not appear, inspect `memory_status` before trying manual recovery steps
- Use `memory_import_codex` only for manual catch-up, older sessions, or filtered imports
- Use `memory_review` when the user asks what Locus stored, why a memory exists, what can be cleaned up, or which durable facts are active/stale/superseded
- Save important decisions when the user makes architecture choices
- Use `memory_remember` for architectural choices, trade-offs, and why a path was chosen, not only for end-of-task summaries
- Use `memory_scan` after significant file structure changes
- Prefer `memory_search` over re-reading files when looking for past context after `memory_recall` has already been tried
- After completing a major task, call `memory_remember` with a concise summary when the outcome should persist across sessions
- Treat capture modes precisely:
  - `metadata` means ingestion and diagnostics first, with limited conversational recall
  - `redacted` is the recommended practical rich-recall mode for Codex because it stores high-value snippets with privacy filtering
  - `full` is maximum local capture and must be described with an explicit privacy warning, never as risk-free
- If the task clearly involves secrets, tokens, passwords, or highly sensitive material, remind the user that `LOCUS_CODEX_CAPTURE=full` / `LOCUS_CAPTURE_LEVEL=full` may store sensitive local memory content
- Codex CLI is the validated primary path. Do not claim Codex desktop or extension parity unless the current environment has been tested through that surface
