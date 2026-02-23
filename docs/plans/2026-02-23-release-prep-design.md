# Release Prep Design — plugin.json + README.md + LICENSE

> Date: 2026-02-23
> Author: Magnifico4625 + Claude
> Status: Approved

---

## Context

Locus v0.1.0 MVP is complete with 485/485 tests, clean lint, clean typecheck,
and all GPT audit findings resolved. The next step is preparing the plugin for
real-world testing and eventual npm/marketplace publication.

Three files are missing:
- `README.md` — no project documentation
- `LICENSE` — no license file (MIT declared in package.json but file absent)
- `plugin.json` — exists but incomplete (empty author/homepage/repository, no hooks reference)

Additionally, `hooks/hooks.json` is missing — the hook file exists (`hooks/post-tool-use.js`)
but without the JSON manifest Claude Code cannot auto-register it.

## Decisions

### Author & Repository
- **Author:** Magnifico4625 <vozol81@mail.ru>
- **Repository:** https://github.com/Magnifico4625/locus
- **License:** MIT

### plugin.json — Full manifest with explicit paths (Approach A)

Rationale: Explicit manifest is more reliable than auto-discovery. We reference
`.mcp.json` and `hooks/hooks.json` directly so Claude Code knows exactly what
to load. Auto-discovery (Approach B) was rejected because hooks without
`hooks.json` won't register automatically.

**Target plugin.json:**
```json
{
  "name": "locus",
  "version": "0.1.0",
  "description": "Persistent project-aware memory for Claude Code. Structural map, decisions, session history — zero native deps.",
  "author": {
    "name": "Magnifico4625",
    "email": "vozol81@mail.ru"
  },
  "repository": "https://github.com/Magnifico4625/locus",
  "homepage": "https://github.com/Magnifico4625/locus",
  "license": "MIT",
  "keywords": ["memory", "mcp", "codebase", "context", "ai-agent"],
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json"
}
```

### hooks/hooks.json — New file

Register the post-tool-use hook so Claude Code invokes it automatically:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Write|Edit|Bash|Glob|Grep|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js"
          }
        ]
      }
    ]
  }
}
```

### LICENSE — Standard MIT 2026

Standard MIT license text with:
- Year: 2026
- Copyright holder: Magnifico4625

### README.md — Full documentation (English)

Structure:
1. **Header** — Name, tagline, badges (npm version, Node requirement, license, tests)
2. **What is Locus?** — Problem statement, 3-layer solution, comparison with CLAUDE.md
3. **Features** — Bullet list of key capabilities
4. **Quick Start** — Prerequisites, install as plugin, first scan
5. **Tools Reference** — Table of 9 MCP tools with parameters and descriptions
6. **Resources** — 3 auto-injected MCP resources with token budgets
7. **Configuration** — captureLevel, environment variables, defaults
8. **Security** — 4-layer security model overview
9. **Architecture** — Text diagram of 3 memory layers, scanning, storage
10. **Development** — Clone, install, test, build, lint
11. **License** — MIT link

## Files to Create/Modify

| File | Action | Notes |
|------|--------|-------|
| `.claude-plugin/plugin.json` | **Modify** | Add author, repo, homepage, keywords, mcpServers, hooks |
| `hooks/hooks.json` | **Create** | Hook manifest for PostToolUse auto-registration |
| `LICENSE` | **Create** | MIT 2026, Magnifico4625 |
| `README.md` | **Create** | Full English documentation |
| `package.json` | **Modify** | Add author field, add homepage/repository |

## Out of Scope

- CHANGELOG.md (can be added later)
- README.ru.md (bilingual rejected)
- npm publish (separate task)
- GitHub repo creation (manual step)
