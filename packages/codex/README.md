# @locus/codex

Codex CLI adapter for [Locus](https://github.com/Magnifico4625/locus) persistent memory.

## Quick Start

### 1. Add MCP Server

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

Or edit `~/.codex/config.toml` directly (see `config/config.toml.example`).

### 2. Install Skill (optional)

Copy `skills/locus-memory/` to `~/.agents/skills/locus-memory/`.

### 3. Verify

```bash
codex "Search memory for recent decisions"
```

## What Works

- All 12 MCP tools (memory_search, memory_remember, memory_explore, etc.)
- All 3 MCP resources (project-map, decisions, recent)
- SQLite storage with FTS5 full-text search
- Client-aware storage: data stored in `$CODEX_HOME/memory/`

## What's Coming

- Session JSONL adapter for passive conversation capture
- npm package for `npx` one-liner install
