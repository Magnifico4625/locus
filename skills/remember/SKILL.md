---
name: remember
description: Save a project decision or context to Locus semantic memory. Use when the user says "remember this", "save this decision", or wants to store architectural context for future sessions.
argument-hint: <text> [--tags tag1,tag2]
---

Save the given text to Locus semantic memory using the `memory_remember` MCP tool.

The text is automatically redacted (passwords, API keys, tokens are stripped).

## Usage
- `/locus:remember We chose JWT over sessions for auth` — save a decision
- `/locus:remember Use Prisma for DB access --tags db,orm` — save with tags

## What to do
1. Extract the text from `$ARGUMENTS`
2. If `--tags` flag is present, parse tags as comma-separated list
3. Call the `memory_remember` tool with `text` and optional `tags` parameters
4. Report what was saved and its ID
