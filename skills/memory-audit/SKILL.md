---
name: memory-audit
description: Audit Locus stored data — shows inventory of structural map, semantic memories, episodic entries, hook captures, DB size, and security status. Use when the user wants to know what data Locus has stored.
---

Show a detailed Locus data audit using the `memory_audit` MCP tool.

## What to do
1. Call the `memory_audit` tool (no parameters)
2. Present the audit report clearly:
   - Capture level
   - Structural map (files, exports, imports)
   - Semantic memory (count, tokens)
   - Episodic memory (count, sessions, tokens)
   - Hook captures (count, capture mode)
   - DB and log file sizes
   - Security status (secrets detected or not)
