---
name: memory-status
description: Show Locus memory statistics — files indexed, memories stored, DB size, scan strategy, backend info. Use when the user asks about memory status, storage info, or plugin health overview.
---

Show Locus memory statistics using the `memory_status` MCP tool.

## What to do
1. Call the `memory_status` tool (no parameters)
2. Present the results in a clear table format:
   - Project root and detection method
   - Storage backend (node:sqlite or sql.js)
   - FTS5 availability
   - DB path and size
   - File counts (total, skipped)
   - Memory counts (semantic, episodic)
   - Last scan info (timestamp, strategy)
   - Capture level
