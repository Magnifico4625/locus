---
name: compact
description: Clean up old episodic memory entries to free space. Keeps recent sessions intact.
---

Clean up old episodic memory by invoking the `memory_compact` MCP tool.

By default, removes episodic entries older than 30 days while keeping the 5 most recent sessions intact. Semantic memories (decisions) are never deleted.

## What to do
1. Call the `memory_compact` tool (optionally with `maxAgeDays` and `keepSessions` parameters)
2. Present the results: how many entries were deleted, how many remain, how many sessions remain
3. If nothing was deleted, inform the user that episodic memory is already clean
