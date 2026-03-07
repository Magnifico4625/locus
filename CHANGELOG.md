# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.1] - 2026-03-07

### Fixed
- Hooks failed in plugin cache with `ERR_MODULE_NOT_FOUND` — bare import `@locus/shared-runtime` requires npm workspace symlinks that don't exist in `git clone`; switched to relative import `../../shared-runtime/index.js`
- All 3 hooks (Stop, PostToolUse, UserPromptSubmit) were non-functional in v3.1.0 marketplace installs

## [3.1.0] - 2026-03-06

### Added
- `@locus/shared-runtime` package — client-aware path resolution (Claude Code, Codex CLI, generic)
- `@locus/codex` skeleton — Codex CLI skill + config examples
- `detectClientEnv()` API for automatic client detection
- `resolveStorageRoot/ProjectStorageDir/DbPath/InboxDir/LogPath()` unified path API
- `expandTilde()` for literal `~` in env vars from config files
- 17 regression tests for Claude/Codex/generic path resolution

### Changed
- Core + hooks switched to `@locus/shared-runtime` for path resolution (backward-compatible aliases kept)
- Path resolver priority: `LOCUS_STORAGE_ROOT` > `CODEX_HOME` > `CLAUDE_PLUGIN_ROOT` > `~/.locus/memory`

### Fixed
- Expand `~` in `CODEX_HOME` and `LOCUS_STORAGE_ROOT` env vars

### Security
- Updated MCP SDK to 1.27.1, hono to 4.12.5 — closed all 4 Dependabot alerts

## [3.0.5] - 2026-03-06

### Fixed
- FTS5 tables never created if DB first opened without FTS5 support — migration V1/V2 conditionally create FTS tables but bump `schema_version` unconditionally
- Added `ensureFts()` post-migration — auto-creates missing FTS tables and rebuilds index on every startup
- `memories_fts` external content table — always rebuild (COUNT trap: reads content table, not index)

### Changed
- Enhanced `memory_doctor`: 10 to 12 checks (FTS5 memories index + conversation index health)
- Enhanced `memory_audit`: FTS5 health section with index sync status

## [3.0.4] - 2026-03-05

### Fixed
- `dist/` was gitignored — cached plugin had no MCP server binary
- `.mcp.json` used relative path — MCP server couldn't start from plugin cache; switched to `${CLAUDE_PLUGIN_ROOT}`

## [3.0.3] - 2026-03-03

### Fixed
- Multi-session SQLite access — enabled WAL mode + `busy_timeout` + `synchronous=NORMAL`
- Root cause: DELETE journal mode + no `busy_timeout` = second session's MCP server fails
- Flat `.mcp.json` format for plugin auto-discovery

### Changed
- AI Council future-vision docs cleaned up after fact-check

## [3.0.2] - 2026-03-02

### Fixed
- Added stdin bootstrap to all 3 hooks — hooks were silently not executing since v3.0.0
- `if (process.argv[1] === fileURLToPath(import.meta.url))` guard + stdin reader
- `post-tool-use.js` now uses `event?.cwd` (was missing)
- 2 pre-existing flaky tests (inbox race conditions)

### Added
- 7 E2E subprocess tests (`hook-subprocess.test.ts`)

## [3.0.1] - 2026-02-27

### Fixed
- FTS5 syntax error on dots/hyphens in `SemanticMemory.search` — moved `sanitizeFtsQuery` to shared utils
- Upgraded rollup to 4.59.0 via npm overrides (Dependabot alert)

### Added
- FAQ section in README with MCP-only feature matrix

## [3.0.0] - 2026-02-27

### Added
- **Carbon Copy** — zero-cost passive capture of prompts, AI responses, and file changes
- Inbox-based event protocol: adapters write JSON events, 4-phase ingest pipeline processes them
- 3 Claude Code hooks: UserPromptSubmit (prompt), Stop (transcript parser), PostToolUse (file changes)
- New DB tables: `conversation_events`, `event_files`, `conversation_fts` (FTS5), `ingest_log`
- Extended `memory_search`: `timeRange`, `filePath`, `kind`, `source`, `limit`, `offset` params
- `memory_timeline` tool for chronological event browsing
- Enhanced `locus://recent` resource with conversation stats and captureLevel-gated prompts
- RAKE keyword extraction for redacted captureLevel
- Hook-level secret redaction before inbox write (double redaction)
- Deterministic `source_event_id` for idempotent ingestion
- File denylist and per-file error isolation in ingest pipeline
- Carbon Copy end-to-end integration tests
- 12 MCP tools, 8 skills, 789 tests

### Changed
- MCP-first positioning — works with any MCP-compatible client
- Processing policy: startup (all), before search (max 50), debounce 30s (max 100)
- `hook_captures` table marked as legacy (read-only)

## [0.2.0] - 2026-02-24

### Added
- `memory_compact` tool and `/locus:compact` skill
- `memory_config` tool and `/locus:memory-config` skill
- `searchEngine` field in status output
- `LOCUS_CAPTURE_LEVEL` env var support in MCP server

### Fixed
- Use NULL for language/confidence on skipped entries
- Remove duplicate hooks entry
- Improved FTS5 doctor message

## [0.1.0] - 2026-02-23

### Added
- Initial release — persistent project-aware memory for Claude Code
- 3-layer memory: structural (project map), semantic (decisions), episodic (session history)
- File parsers: TypeScript, Python, config files
- Path aliases, ignore rules, confidence scoring
- SQLite storage with FTS5 full-text search
- MCP server with tools and resources
- 4-layer security: metadata-only, file denylist, content redaction, audit UX
- PostToolUse hook for automatic capture
- `memory_scan`, `memory_search`, `memory_explore`, `memory_remember`, `memory_forget`, `memory_purge`, `memory_status`, `memory_doctor`, `memory_audit` tools

[Unreleased]: https://github.com/Magnifico4625/locus/compare/v3.1.1...HEAD
[3.1.1]: https://github.com/Magnifico4625/locus/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/Magnifico4625/locus/compare/v3.0.5...v3.1.0
[3.0.5]: https://github.com/Magnifico4625/locus/compare/v3.0.4...v3.0.5
[3.0.4]: https://github.com/Magnifico4625/locus/compare/v3.0.3...v3.0.4
[3.0.3]: https://github.com/Magnifico4625/locus/compare/v3.0.1...v3.0.3
[3.0.2]: https://github.com/Magnifico4625/locus/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/Magnifico4625/locus/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/Magnifico4625/locus/compare/v0.2.0...v3.0.0
[0.2.0]: https://github.com/Magnifico4625/locus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Magnifico4625/locus/releases/tag/v0.1.0
