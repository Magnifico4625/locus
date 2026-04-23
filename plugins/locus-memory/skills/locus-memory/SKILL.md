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
2. **memory_search** -- FTS5 search across all memory layers
3. **memory_remember** -- Save architecture decisions with auto-redaction
4. **memory_explore** -- Navigate the project file tree
5. **memory_timeline** -- View recent conversation history
6. **memory_status** -- Memory health and storage info
7. **memory_scan** -- Re-index project structure after file changes

## Key Behaviors

- Always check Locus before saying you do not remember prior work or prior decisions
- Use `memory_recall` first for questions about past work, prior decisions, or recent progress such as:
  - "what did we do yesterday?"
  - "what did we decide about auth?"
  - "what did we just fix?"
- In Codex, recent dialogue is auto-imported before `memory_recall` and `memory_search`
- If `memory_recall` returns `needs_clarification`, ask a focused follow-up question after the lookup instead of guessing or asking before checking Locus
- If `memory_recall` returns `no_memory`, then fall back to `memory_search` or `memory_timeline` only when raw search or chronology is still useful
- If recent Codex history does not appear, inspect `memory_status` before trying manual recovery steps
- Use `memory_import_codex` only for manual catch-up, older sessions, or filtered imports
- Save important decisions when the user makes architecture choices
- Use `memory_remember` for architectural choices, trade-offs, and why a path was chosen, not only for end-of-task summaries
- Use `memory_scan` after significant file structure changes
- Prefer `memory_search` over re-reading files when looking for past context after `memory_recall` has already been tried
- After completing a major task, call `memory_remember` with a concise summary when the outcome should persist across sessions
- If the task clearly involves secrets, tokens, passwords, or highly sensitive material, remind the user that capture settings such as `LOCUS_CODEX_CAPTURE=full` may store redacted local memory content
