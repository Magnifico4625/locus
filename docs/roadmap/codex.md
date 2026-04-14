# Codex Roadmap

**Date:** 2026-04-10
**Baseline:** current stable local HEAD before Codex-specific work
**Primary goal:** make Locus a first-class persistent memory layer for Codex CLI and the Codex VS Code extension without changing Claude Code behavior.

---

## Direction

Codex support should evolve as a separate product line inside the existing monorepo:

- `packages/core` remains the shared MCP server, storage, search, and ingest engine.
- `packages/shared-runtime` remains the shared path/client detection layer.
- `packages/claude-code` remains untouched unless a shared contract explicitly requires it.
- `packages/codex` becomes the home for Codex-specific adapters, skills, config examples, and future plugin packaging.

The architectural rule is simple: **do not fork Locus into a separate Codex project**. Add Codex functionality through thin adapters that feed the existing inbox and database pipeline.

---

## Git Workflow

Work locally first.

Recommended baseline checkpoint:

```bash
git tag -a codex-baseline-2026-04-10 -m "Codex roadmap baseline before JSONL adapter work"
```

Why tag instead of branch:

- A tag is an immutable checkpoint for the current stable state.
- Feature branches can move, but the baseline should not.
- It gives a clean rollback/reference point before Codex-specific changes.

Recommended implementation branch:

```bash
git checkout -b feature/codex-jsonl-adapter
```

Push branches to GitHub only after the first meaningful passing test checkpoint.

---

## Capture Policy

Codex capture should default to **metadata**.

Recommended Codex-specific switch:

```toml
[mcp_servers.locus.env]
CODEX_HOME = 'C:\Users\Admin\.codex'
LOCUS_CODEX_CAPTURE = "metadata"
LOCUS_CAPTURE_LEVEL = "metadata"
```

Planned values:

| Value | Behavior |
|-------|----------|
| `off` | Do not import Codex session JSONL events |
| `metadata` | Import session/tool metadata without prompt/assistant text |
| `redacted` | Import user prompt text after redaction or keyword extraction; skip assistant text |
| `full` | Import user and assistant dialogue after redaction |

`LOCUS_CODEX_CAPTURE` controls whether the Codex adapter reads session files.
`LOCUS_CAPTURE_LEVEL` remains the core ingest pipeline's second-defense gate.

---

## Phase 1 — Codex Carbon Copy Foundation

Goal: import Codex session history into the existing Locus inbox pipeline.

Implementation plan: `docs/superpowers/plans/2026-04-10-codex-jsonl-adapter-phase-1.md`

Status: implemented as the library foundation on `feature/codex-jsonl-adapter`. The MCP-facing `memory_import_codex` tool was added in Phase 2 on `feature/codex-manual-import`.

Implemented:

- `packages/codex` parses tolerant Codex JSONL records.
- `packages/codex` discovers `$CODEX_HOME/sessions/**/rollout-*.jsonl`, with fallback to `~/.codex/sessions`.
- `importCodexSessionsToInbox()` converts rollout sessions into existing `InboxEvent v1` JSON files.
- `LOCUS_CODEX_CAPTURE` supports `off`, `metadata`, `redacted`, and `full`.
- Core compatibility is proven programmatically by importing Codex fixtures into a temp inbox and passing them through `processInbox()`.

Tasks:

- Add a Codex JSONL parser in `packages/codex`.
- Read session rollout files from `$CODEX_HOME/sessions/**/rollout-*.jsonl`, falling back to `~/.codex/sessions` when `CODEX_HOME` is not set.
- Convert Codex records into existing `InboxEvent` v1 JSON files.
- Keep parser tolerant of unknown record types and schema changes.
- Deduplicate via stable `source_event_id`.
- Add sanitized JSONL fixtures from real Codex rollout shapes.
- Add tests for empty files, malformed JSON, unknown event types, and duplicate imports.
- Require the importer caller to pass the Locus `inboxDir`; `packages/codex` must not guess core storage paths.

Initial event mapping:

| Codex JSONL record | Locus event |
|--------------------|-------------|
| `event_msg:user_message` | `user_prompt` |
| `response_item:message:assistant` | `ai_response` |
| `response_item:function_call` | `tool_use` |
| `response_item:function_call_output` | `tool_use` metadata or result metadata |
| `session_meta` | `session_start` |
| `event_msg:task_complete` | `session_end` |

Exit criteria:

- Codex session JSONL can be imported into Locus inbox.
- Existing `processInbox()` stores imported events in SQLite and FTS5.
- Programmatic compatibility with `memory_timeline` storage is proven through core ingest tests. User-visible manual timeline inspection is enabled in Phase 2 through `memory_import_codex`.
- Claude Code hooks remain unchanged and tests still pass.

---

## Phase 2 — Manual Import Tool

Goal: expose Codex import through MCP so users and Codex itself can trigger it.

Status: implemented locally on `feature/codex-manual-import` with green targeted tests. This phase adds the MCP-facing manual import path and remains the explicit control path even after Phase 3 auto-import.

Implemented:

- `memory_import_codex` MCP tool in `packages/core`.
- Support for `latestOnly`, `projectRoot`, `sessionId`, and `since` filters.
- Respect for `LOCUS_CODEX_CAPTURE`, including explicit disabled responses when capture is `off`.
- Bulk dedup against `ingest_log` so repeated imports do not re-ingest the same Codex events.
- Immediate `processInbox()` after import so imported Codex dialogue is searchable right away.
- Regression and integration coverage proving startup stability, exact import metrics, immediate searchability, and repeated-import idempotency.

Tasks:

- Add `memory_import_codex` MCP tool.
- Return import metrics: `imported`, `skipped`, `duplicates`, `errors`, `filesScanned`, `latestSession`.
- Support optional filters: latest only, project root, session id, since timestamp.
- Respect `LOCUS_CODEX_CAPTURE`.
- Report when capture is disabled.
- Add tests for import metrics and capture-level behavior.

Exit criteria:

- User can run `memory_import_codex` from Codex.
- Imported Codex conversations become searchable through `memory_search`.
- No repeated imports on repeated tool calls.

Next step at the time of Phase 2 completion: Phase 3 — Auto Import Before Search.

---

## Phase 3 — Auto Import Before Search

Goal: make Codex memory feel persistent without requiring manual import every time.

Implementation plan: `docs/superpowers/plans/2026-04-12-codex-auto-import-phase-3.md`

Status: implemented locally on `feature/codex-auto-import` with green targeted tests. Auto-import now reuses the Phase 2 import path, runs before `memory_search` only for Codex, and surfaces last-run state through `memory_status`.

Implemented:

- Search-time Codex auto-import in `packages/core` reusing `handleImportCodex({ latestOnly: true })`.
- Debounced server-local coordinator with best-effort semantics.
- Search remains usable when Codex import is disabled or errors.
- `memory_status` includes `codexAutoImport` snapshot fields for last attempt/result visibility.
- Regression coverage proving non-Codex search paths still work without `CODEX_HOME`.

Tasks:

- Trigger Codex import before `memory_search` when Codex environment is detected.
- Add debounce, for example 30-60 seconds.
- Limit per-run work to avoid scanning all history repeatedly.
- Keep import best-effort: failures must not block search.
- Surface last import status in `memory_status` or `memory_config`.

Exit criteria:

- Recent Codex dialogue is available before search with minimal user action.
- Search latency remains acceptable.
- Import errors are visible but non-fatal.

Next step: Phase 4 — Codex Skill Upgrade.

---

## Phase 4 — Codex Skill Upgrade

Goal: make Codex use Locus consistently and predictably.

Implementation plan: `docs/superpowers/plans/2026-04-13-codex-skill-upgrade-phase-4.md`

Status: implemented locally on `feature/codex-skill-upgrade` with green targeted tests. The canonical Codex skill now reflects Phase 3 auto-import behavior, and the repo includes a reproducible local skill sync path.

Implemented:

- `packages/codex/skills/locus-memory/SKILL.md` now points Codex toward `memory_search` first, `memory_status` for diagnostics, and `memory_import_codex` only for manual catch-up or filtered imports.
- `memory_remember` guidance now emphasizes architectural decisions, trade-offs, and reasons behind the chosen path.
- `npm run sync:codex-skill` syncs the canonical repo skill into the installed local Codex skill directory.
- Docs now distinguish the primary validated CLI workflow from VS Code / IDE surfaces that still depend on upstream MCP exposure.

Tasks:

- Update `packages/codex/skills/locus-memory/SKILL.md`.
- Instruct Codex to use `memory_search` before re-asking project questions.
- Instruct Codex to inspect `memory_status` when recent history does not appear as expected.
- Instruct Codex to call `memory_remember` after important decisions.
- Keep `memory_import_codex` documented as the explicit manual catch-up path for older sessions or filtered imports.
- Add guidance for capture levels and privacy.
- Install/update the local user skill after changes.

Exit criteria:

- New Codex sessions discover and follow the improved memory workflow.
- Skill behavior is clear without being overly aggressive.

Next step: Phase 5 — Codex Doctor And Status.

---

## Phase 5 — Codex Doctor And Status

Goal: make Codex memory support diagnosable by users.

Implementation plan: `docs/superpowers/plans/2026-04-14-codex-doctor-status-phase-5.md`

Status: implemented locally on `feature/codex-doctor-status` with green targeted tests. `memory_status` now returns structured Codex diagnostics, and `memory_doctor` now surfaces Codex-specific checks and common fixes when `CODEX_HOME` is present.

Implemented:

- `memory_status` exposes `codexDiagnostics` for `sessions/` discovery, latest rollout readability, capture mode, imported-event count, and latest imported session/timestamp.
- `memory_doctor` adds Codex checks for sessions directory presence, latest rollout readability, capture mode, imported-event count, and latest imported event visibility.
- Integration coverage proves Codex diagnostics appear only when `CODEX_HOME` is present and that generic paths remain unchanged otherwise.
- Docs now explain the Codex diagnosis workflow: `memory_search` first, then `memory_status`, then `memory_doctor`, then manual `memory_import_codex` only when needed.

Tasks:

- Extend `memory_doctor` with Codex checks when `CODEX_HOME` is present.
- Check `$CODEX_HOME/sessions` exists.
- Check latest `rollout-*.jsonl` can be read.
- Show `LOCUS_CODEX_CAPTURE` value.
- Show imported Codex event count.
- Show latest imported session timestamp.
- Add docs for common fixes.

Exit criteria:

- A user can diagnose why Codex conversations are or are not being imported.
- Support questions can be answered from `memory_doctor` output.

Next step: Phase 6 — Codex VS Code Extension Documentation.

---

## Phase 6 — Codex VS Code Extension Documentation

Goal: document the path for users who use Codex through VS Code.

Implementation plan: `docs/superpowers/plans/2026-04-14-codex-vscode-extension-phase-6.md`

Status: in progress locally on `feature/codex-vscode-extension-docs`. This phase is documentation-only: it packages the existing Codex CLI + MCP setup into a dedicated VS Code extension guide and makes the upstream extension boundary explicit.

Target deliverables:

- dedicated `docs/codex-vscode-extension.md` how-to guide
- concise README links into the guide instead of duplicated troubleshooting text
- `packages/codex/README.md` and `config.toml.example` aligned with the VS Code path
- explicit explanation of what Locus controls locally vs. what still depends on upstream Codex extension MCP exposure

Tasks:

- Add a `Codex VS Code Extension` section to README.
- Explain that the VS Code extension uses Codex MCP configuration.
- Document setup through `codex mcp add locus -- node /path/to/locus/dist/server.js`.
- Tell users to restart VS Code / the Codex extension after configuration changes.
- Clarify what works today: MCP tools and resources.
- Clarify what requires the JSONL adapter: passive conversation capture.

Exit criteria:

- GitHub issues like "does this support Codex for VS Code?" have a documented answer.

Next step: Phase 7 — Codex Plugin Packaging.

---

## Phase 7 — Codex Plugin Packaging

Goal: improve installation UX after the adapter is stable.

Implementation plan: `docs/superpowers/plans/2026-04-14-codex-plugin-packaging-phase-7.md`

Status: in progress locally on `feature/codex-plugin-packaging`. This phase packages the already-working Codex path into a repo-local plugin bundle and marketplace entry without changing runtime behavior or replacing manual MCP setup.

Target deliverables:

- repo-local plugin bundle under `plugins/locus-memory/`
- repo-local marketplace entry in `.agents/plugins/marketplace.json`
- plugin sync helper so bundled skill content stays aligned with the canonical Codex skill
- docs that position plugin packaging as optional onboarding, not a new runtime requirement

Tasks:

- Research current Codex plugin manifest format.
- Package Locus skill + MCP configuration guidance.
- Avoid making plugin packaging required for core functionality.
- Keep manual MCP setup documented and supported.

Exit criteria:

- Plugin improves onboarding but does not replace MCP/server compatibility.

---

## Phase 8 — Release Plan

Suggested releases:

| Version | Scope |
|---------|-------|
| `v3.2.0-alpha.1` | Codex JSONL parser + manual import tool |
| `v3.2.0-alpha.2` | Capture levels + timeline/search integration |
| `v3.2.0` | Stable Codex Carbon Copy |
| `v3.3.0` | Codex plugin packaging and improved install UX |

Release gates:

- `npm run typecheck`
- `npm test`
- Codex E2E smoke test with `memory_status`
- Import fixture tests
- Real local Codex session import smoke test
- No changes to Claude Code hook behavior unless explicitly planned

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Codex JSONL schema changes | High | Tolerant parser, fixtures, unknown-event skip |
| Sensitive dialogue capture | High | Default `metadata`, redaction before storage, audit tooling |
| Duplicate imports | Medium | Stable `source_event_id`, import state, ingest log |
| Slow search due to auto-import | Medium | Debounce, batch limits, latest-session mode |
| Plugin format churn | Medium | Treat plugin as packaging, not core architecture |
| Claude regression | High | Keep Claude hooks untouched, run full regression suite |

---

## Immediate Next Steps

1. Finish Phase 7 local validation and checkpointing on `feature/codex-plugin-packaging`.
2. Start release-planning follow-up only after the repo-local plugin packaging path is stable.
3. Keep CLI as the primary validated path while continuing to document IDE-specific MCP limitations honestly.
4. Keep Claude Code behavior unchanged while Codex-specific work continues.
