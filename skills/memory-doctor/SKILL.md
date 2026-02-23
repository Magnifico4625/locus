---
name: memory-doctor
description: Run Locus environment health check — 10-point diagnostic covering Node.js version, storage backend, FTS5, DB permissions, git availability, and more. Use when troubleshooting plugin issues or checking setup.
---

Run Locus health diagnostics using the `memory_doctor` MCP tool.

## What to do
1. Call the `memory_doctor` tool (no parameters)
2. Present results as a table with columns: Check, Status, Details
3. Use OK/WARN/FAIL status indicators
4. For any WARN or FAIL, show the suggested fix
5. Show summary: N passed, N warnings, N failures
