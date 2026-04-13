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

1. **memory_search** -- FTS5 search across all memory layers
2. **memory_remember** -- Save architecture decisions with auto-redaction
3. **memory_explore** -- Navigate the project file tree
4. **memory_timeline** -- View recent conversation history
5. **memory_status** -- Memory health and storage info
6. **memory_scan** -- Re-index project structure after file changes

## Key Behaviors

- Always search memory before re-asking questions the user already answered
- In Codex, recent dialogue is auto-imported before `memory_search`, so use `memory_search` first for recent history and prior decisions
- If recent Codex history does not appear, inspect `memory_status` before trying manual recovery steps
- Use `memory_import_codex` only for manual catch-up, older sessions, or filtered imports
- Save important decisions when the user makes architecture choices
- Use `memory_remember` for architectural choices, trade-offs, and why a path was chosen, not only for end-of-task summaries
- Use `memory_scan` after significant file structure changes
- Prefer `memory_search` over re-reading files when looking for past context
- After completing a major task, call `memory_remember` with a concise summary when the outcome should persist across sessions
- If the task clearly involves secrets, tokens, passwords, or highly sensitive material, remind the user that capture settings such as `LOCUS_CODEX_CAPTURE=full` may store redacted local memory content
