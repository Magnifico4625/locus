---
name: memory-purge
description: Delete ALL Locus memory for the current project. This is destructive and irreversible.
disable-model-invocation: true
---

Purge all Locus project memory using the `memory_purge` MCP tool.

WARNING: This is destructive and irreversible. Only the user should invoke this.

## What to do
1. Call `memory_purge` without a confirmToken — this returns stats and a token
2. Show the user exactly what will be deleted (files, memories, episodes, DB size)
3. Ask the user to confirm explicitly
4. Only if confirmed, call `memory_purge` again with the `confirmToken`
5. Report the result
