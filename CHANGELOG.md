# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.4.0] - 2026-04-23

### Added
- Track A Codex memory trust release with validated `redacted` conversational recall for Codex CLI
- `memory_recall` as the recommended summary-first path for questions about previous work, decisions, and dated context
- Durable-memory cleanup/review workflow so agents can propose stale or superseded memory cleanup without deleting automatically
- Runtime truth diagnostics that separate Codex CLI validation from unverified Codex desktop / extension parity

### Changed
- Codex documentation now recommends `LOCUS_CODEX_CAPTURE=redacted` plus `LOCUS_CAPTURE_LEVEL=redacted` for practical recall
- `memory_recall` now searches matching `conversation_events` beyond the latest timeline window before falling back to recent events
- README, Codex docs, acceptance matrix, and GitHub Pages landing page now describe Track A as shipped behavior, not future work
- Release validation now includes real local live recall checks against Codex CLI `0.123.0`

### Fixed
- Codex CLI `0.123.0` JSONL compatibility: payload-wrapped records using `raw.payload.type` are now normalized correctly
- Live Codex dialogue markers are now imported and searchable in `redacted` mode without explicit `memory_remember`
- `memory_recall` no longer returns `no_memory` simply because a matching event is older than the default recent timeline window

### Security
- Refreshed `package-lock.json` with `npm audit fix --package-lock-only --ignore-scripts`; `npm audit --audit-level=moderate` now reports 0 vulnerabilities

### Notes
- `needs_clarification` remains valid when multiple matching Codex conversation events exist; ranking polish for duplicate-heavy recalls remains future UX work
- Codex desktop / extension parity is still reported as unverified until validated in that surface

## [3.3.0] - 2026-04-15

### Added
- Codex manual import pipeline via `memory_import_codex` with `latestOnly`, `projectRoot`, `sessionId`, and `since` filters
- Codex auto-import before `memory_search` with bounded debounce and best-effort semantics
- Codex-aware `memory_status` and `memory_doctor` diagnostics for `CODEX_HOME`, rollout discovery, capture mode, and imported-event visibility
- Canonical Codex skill workflow plus repo-local sync helpers: `npm run sync:codex-skill` and `npm run sync:codex-plugin`
- Repo-local Codex plugin bundle under `plugins/locus-memory/` and repo marketplace entry under `.agents/plugins/marketplace.json`
- Dedicated Codex VS Code extension guide and release notes for the Codex workflow

### Changed
- Codex is now a first-class supported product line inside the Locus monorepo rather than a skeleton/in-progress integration
- Codex CLI documentation now treats `memory_search`, `memory_status`, `memory_doctor`, and manual `memory_import_codex` as the validated workflow
- Release validation now includes a real local Codex acceptance gate before GitHub push

### Fixed
- Real local Codex acceptance verified that `memory_import_codex` is reliable through `since`-based ingestion and idempotent re-imports
- Repo-local plugin packaging now stays aligned with the canonical Codex skill through the sync helper

### Notes
- Default Codex capture remains `metadata`, so `v3.3.0` validates ingestion, diagnostics, and idempotency rather than full semantic recall of dialogue text
- Richer conversational recall for Codex through `redacted` or `full` capture modes remains a future-release track

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

[Unreleased]: https://github.com/Magnifico4625/locus/compare/v3.4.0...HEAD
[3.4.0]: https://github.com/Magnifico4625/locus/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/Magnifico4625/locus/compare/v3.1.1...v3.3.0
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
