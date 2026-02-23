---
name: forget
description: Delete memory entries from Locus matching a search query. Use when the user says "forget this", "delete memory", or "remove that decision".
argument-hint: <query>
---

Delete Locus memory entries matching the query using the `memory_forget` MCP tool.

## Usage
- `/locus:forget JWT decision` — delete entries matching "JWT decision"

## What to do
1. Call `memory_forget` with `query` from `$ARGUMENTS`
2. If >5 matches found, the tool returns a `confirmToken` — ask the user to confirm
3. If confirmed, call `memory_forget` again with the `confirmToken`
4. Report how many entries were deleted
