---
name: memory
description: Locus memory management commands — remember decisions, search memory, manage project context
triggers:
  - /remember
  - /forget
  - /compact
  - /memory-status
  - /memory-doctor
  - /memory-audit
  - /memory-purge
  - /memory-config
---

# Locus Memory Commands

## /remember <text>
Save a project decision or context to semantic memory.
Text is redacted before storage. Use tags with `--tags tag1,tag2`.

## /forget <query>
Delete memory entries matching the query. If >5 matches, requires confirmation.

## /compact
Manually trigger episodic memory compression.

## /memory-status
Show memory statistics: files indexed, memories stored, DB size, scan strategy.

## /memory-doctor
Run environment self-check: Node version, FTS5, permissions, DB health.

## /memory-audit
Show all stored data grouped by type with counts and sizes.

## /memory-purge
Delete ALL memory for current project. Requires two-step confirmation.

## /memory-config <key> <value>
Change Locus configuration (captureLevel, maskPaths, compressionMode, etc.).
