---
name: memory-config
description: Show current Locus configuration values and their sources (default, env var, or detected)
---

Show the current Locus memory configuration. Invoke the `memory_config` MCP tool and display the results as a formatted table.

## What to do
1. Call the `memory_config` tool (no parameters)
2. Present the results as a table with columns: Setting, Value, Source
3. Explain that to change configuration, set environment variables (`LOCUS_CAPTURE_LEVEL`, `LOCUS_LOG`) and restart Claude Code

This is a read-only command — it shows current values but does not change them.
