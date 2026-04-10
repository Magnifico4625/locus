# Codex JSONL Adapter Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 Codex Carbon Copy foundation by importing Codex `rollout-*.jsonl` session records into the existing Locus inbox protocol.

**Architecture:** `packages/codex` owns Codex-specific parsing, capture policy, and inbox writing. It must not runtime-import `packages/core`; compatibility with the core ingest pipeline is proven through tests that validate generated `InboxEvent v1` JSON files with core schema and `processInbox()`.

**Tech Stack:** Node.js 22+, TypeScript, ESM, Vitest, npm workspaces, existing Locus `InboxEvent v1` JSON protocol.

---

## Scope

In scope: JSONL parser, sanitized fixtures, normalized Codex events, Codex-to-`InboxEvent v1` mapping, `LOCUS_CODEX_CAPTURE`, atomic inbox writer, importer library, tests, docs.

Out of scope: `memory_import_codex` MCP tool, auto-import before search, plugin packaging, and any Claude Code hook behavior change.

## File Structure

Create:

- `packages/codex/tsconfig.json`
- `packages/codex/src/types.ts`
- `packages/codex/src/ids.ts`
- `packages/codex/src/jsonl.ts`
- `packages/codex/src/normalize.ts`
- `packages/codex/src/capture.ts`
- `packages/codex/src/inbox-event.ts`
- `packages/codex/src/inbox-writer.ts`
- `packages/codex/src/paths.ts`
- `packages/codex/src/session-files.ts`
- `packages/codex/src/importer.ts`
- `packages/codex/src/index.ts`
- `packages/codex/tests/fixtures/*.jsonl`
- `packages/codex/tests/*.test.ts`

Modify:

- `package.json`
- `vitest.config.ts`
- `packages/codex/package.json`
- `docs/roadmap/codex.md`
- `packages/codex/README.md`

Do not modify:

- `packages/claude-code/**`
- `claude-code/hooks/**`

---

## Tasks

### Task 0: Git Baseline And Documentation Checkpoint

**Files:** `docs/roadmap/codex.md`, `docs/superpowers/plans/2026-04-10-codex-jsonl-adapter-phase-1.md`

- [ ] Verify state: `git status --short --branch`.
- [ ] Commit docs only: `git add docs/roadmap/codex.md docs/superpowers/plans/2026-04-10-codex-jsonl-adapter-phase-1.md`.
- [ ] Commit: `git commit -m "docs(codex): add Codex roadmap and phase 1 plan"`.
- [ ] Tag stable baseline: `git tag -a codex-baseline-2026-04-10 -m "Codex roadmap baseline before JSONL adapter work"`.
- [ ] Create branch: `git checkout -b feature/codex-jsonl-adapter`.

Expected: implementation starts from a tagged documentation checkpoint.

### Task 1: Codex Package Test And Typecheck Harness

**Files:** `packages/codex/tsconfig.json`, `packages/codex/tests/harness.test.ts`, `packages/codex/package.json`, `vitest.config.ts`, `package.json`

- [ ] Add `packages/codex/tests/harness.test.ts` with a trivial Vitest smoke test.
- [ ] Add `packages/codex/tsconfig.json` extending `../../tsconfig.base.json`, with `rootDir: "src"` and `outDir: "dist"`.
- [ ] Add `main`, `types`, `exports`, and `scripts.typecheck` to `packages/codex/package.json`.
- [ ] Update `vitest.config.ts` include list to also run `packages/codex/tests/**/*.test.ts`.
- [ ] Update root `typecheck` script to run both `@locus/core` and `@locus/codex`.
- [ ] Validate: `npm test -- packages/codex/tests/harness.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "test(codex): add package test and typecheck harness"`.

### Task 2: Sanitized Codex JSONL Fixtures

**Files:** `packages/codex/tests/fixtures/basic-session.jsonl`, `packages/codex/tests/fixtures/tool-session.jsonl`, `packages/codex/tests/fixtures/malformed-lines.jsonl`, `packages/codex/tests/fixtures/unknown-records.jsonl`

- [ ] Add `basic-session.jsonl` with `session_meta`, `event_msg:user_message`, `response_item:message:assistant`, and `event_msg:task_complete`.
- [ ] Add `tool-session.jsonl` with `response_item:function_call` and `response_item:function_call_output`.
- [ ] Add `malformed-lines.jsonl` with one invalid JSON line between valid records.
- [ ] Add `unknown-records.jsonl` with future/unknown `type` and `subtype` values.
- [ ] Verify no secrets: `rg -n "OPENAI|sk-|token|password|secret|Bearer" packages/codex/tests/fixtures`.
- [ ] Commit: `git commit -m "test(codex): add sanitized JSONL fixtures"`.

### Task 3: Tolerant JSONL Parser

**Files:** `packages/codex/src/types.ts`, `packages/codex/src/jsonl.ts`, `packages/codex/src/index.ts`, `packages/codex/tests/jsonl.test.ts`

- [ ] Write failing tests for valid lines, empty lines, malformed lines, and non-object JSON values.
- [ ] Confirm failure: `npm test -- packages/codex/tests/jsonl.test.ts`.
- [ ] Add parser types: `CodexJsonlRecord`, `CodexJsonlParseError`, `CodexJsonlParseResult`.
- [ ] Implement `parseCodexJsonl(raw: string, filePath: string)`.
- [ ] Parser rules: skip empty lines, parse line-by-line, accept only object records, collect errors, never throw for malformed content.
- [ ] Export parser and types from `packages/codex/src/index.ts`.
- [ ] Validate: `npm test -- packages/codex/tests/jsonl.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): add tolerant JSONL parser"`.

### Task 4: Stable IDs And Source Event Identity

**Files:** `packages/codex/src/ids.ts`, `packages/codex/tests/ids.test.ts`

- [ ] Write failing tests for deterministic `source_event_id` and deterministic SHA-256 `event_id`.
- [ ] Confirm failure: `npm test -- packages/codex/tests/ids.test.ts`.
- [ ] Implement `createCodexSourceEventId({ sessionId, filePath, line, kind, itemId })`.
- [ ] Use format: `codex:${sessionId}:${basename(filePath)}:${line}:${kind}:${itemId}`.
- [ ] Use fallbacks: `unknown-session` and `no-item`.
- [ ] Implement `createCodexEventId(sourceEventId)` using `node:crypto` SHA-256 hex.
- [ ] Validate: `npm test -- packages/codex/tests/ids.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): add stable event identity helpers"`.

### Task 5: Normalize Codex Records

**Files:** `packages/codex/src/normalize.ts`, `packages/codex/src/types.ts`, `packages/codex/tests/normalize.test.ts`

- [ ] Write failing tests for all initial mappings from the roadmap.
- [ ] Confirm failure: `npm test -- packages/codex/tests/normalize.test.ts`.
- [ ] Add `CodexNormalizedKind` with `user_prompt`, `ai_response`, `tool_use`, `session_start`, `session_end`.
- [ ] Add `CodexNormalizedEvent` with `kind`, `timestamp`, `sessionId`, `projectRoot`, `sourceFile`, `sourceLine`, optional `itemId`, and `payload`.
- [ ] Implement `normalizeCodexRecords(records)` returning `{ events, skipped }`.
- [ ] Map `session_meta` to `session_start`.
- [ ] Map `event_msg:user_message` to `user_prompt`.
- [ ] Map assistant `response_item` message records to `ai_response`.
- [ ] Map `response_item:function_call` and `function_call_output` to `tool_use`.
- [ ] Map `event_msg:task_complete` to `session_end`.
- [ ] If `task_complete` contains text or summary fields, preserve that text in normalized payload as `summary`.
- [ ] Unknown records increment `skipped` and do not throw.
- [ ] Validate: `npm test -- packages/codex/tests/normalize.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): normalize Codex session records"`.

### Task 6: Capture Mode Gate

**Files:** `packages/codex/src/capture.ts`, `packages/codex/src/types.ts`, `packages/codex/tests/capture.test.ts`

- [ ] Write failing tests for `off`, `metadata`, `redacted`, `full`, missing env, and invalid env.
- [ ] Confirm failure: `npm test -- packages/codex/tests/capture.test.ts`.
- [ ] Implement `getCodexCaptureMode(env = process.env)`.
- [ ] Accept only `off`, `metadata`, `redacted`, `full`; default invalid/missing values to `metadata`.
- [ ] Implement `shouldImportCodexEvent(mode, kind)`.
- [ ] Gate rules: `off` imports none, `metadata` skips prompt/assistant text, `redacted` skips assistant text, `full` imports all.
- [ ] Add `redactCodexText(text)` for obvious bearer tokens, `sk-...` keys, and secret-like assignments.
- [ ] Add a code comment stating this is best-effort redaction, not a complete DLP guarantee.
- [ ] Validate: `npm test -- packages/codex/tests/capture.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): add capture mode gate"`.

### Task 7: Map Normalized Events To InboxEvent V1

**Files:** `packages/codex/src/inbox-event.ts`, `packages/codex/tests/inbox-event.test.ts`

- [ ] Write failing mapper tests that validate output with `validateInboxEvent()` from `packages/core/src/ingest/schema.ts`.
- [ ] Confirm failure: `npm test -- packages/codex/tests/inbox-event.test.ts`.
- [ ] Define local `LocusInboxEventV1` matching the JSON protocol; do not runtime-import core types.
- [ ] Implement `toInboxEvent(normalizedEvent, captureMode)`.
- [ ] Set `version: 1`, `source: "codex"`, deterministic `event_id`, stable `source_event_id`, `project_root`, `session_id`, `timestamp`, `kind`, and payload.
- [ ] Payload rules: `user_prompt` uses `{ prompt }`, `ai_response` uses `{ response, model? }`, `tool_use` uses `{ tool, files, status, exitCode? }`, `session_start` uses `{ tool: "codex", model? }`, `session_end` uses `{ summary? }`.
- [ ] Assert that `event_msg:task_complete` text reaches `session_end.payload.summary` when present.
- [ ] Ensure `metadata` mode never produces `user_prompt` or `ai_response` inbox events.
- [ ] Validate: `npm test -- packages/codex/tests/inbox-event.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): map sessions to inbox events"`.

### Task 8: Codex Path Resolution And Session File Discovery

**Files:** `packages/codex/src/paths.ts`, `packages/codex/src/session-files.ts`, `packages/codex/tests/session-files.test.ts`

- [ ] Write failing tests using temporary directories.
- [ ] Write failing tests for `CODEX_HOME` resolution: explicit env, `~` expansion, and fallback to `join(homedir(), ".codex")`.
- [ ] Confirm failure: `npm test -- packages/codex/tests/session-files.test.ts`.
- [ ] Implement `resolveCodexHome(env = process.env): string`.
- [ ] Implement `resolveCodexSessionsDir(options)` where explicit `sessionsDir` wins, otherwise use `$CODEX_HOME/sessions`, otherwise `~/.codex/sessions`.
- [ ] Implement `findCodexRolloutFiles(sessionsDir: string): string[]`.
- [ ] Recursively find only `rollout-*.jsonl`.
- [ ] Return sorted absolute paths.
- [ ] Missing sessions directory returns `[]`.
- [ ] Read errors are best-effort and do not throw.
- [ ] Validate: `npm test -- packages/codex/tests/session-files.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): discover rollout session files"`.

### Task 9: Atomic Codex Inbox Writer

**Files:** `packages/codex/src/inbox-writer.ts`, `packages/codex/tests/inbox-writer.test.ts`

- [ ] Write failing tests for directory creation, atomic `*.tmp` rename, final filename, duplicate pending skip, and no leftover temp files.
- [ ] Confirm failure: `npm test -- packages/codex/tests/inbox-writer.test.ts`.
- [ ] Implement `writeCodexInboxEvent(inboxDir, event)`.
- [ ] Filename rule: `${timestamp}-${event_id.slice(0, 8)}.json`.
- [ ] Return `{ status: "written", filename }` or `{ status: "duplicate_pending", filename }`.
- [ ] If final file exists, do not overwrite it.
- [ ] Do not import the core writer at runtime.
- [ ] Validate: `npm test -- packages/codex/tests/inbox-writer.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): write inbox events atomically"`.

### Task 10: Codex Importer Into Inbox

**Files:** `packages/codex/src/importer.ts`, `packages/codex/src/index.ts`, `packages/codex/tests/importer.test.ts`

- [ ] Write failing importer tests against fixture sessions and a temp inbox.
- [ ] Confirm failure: `npm test -- packages/codex/tests/importer.test.ts`.
- [ ] Add `CodexImportMetrics`: `filesScanned`, `recordsParsed`, `parseErrors`, `normalized`, `written`, `duplicatePending`, `skippedUnknown`, `skippedByCapture`, `errors`, `latestSession`.
- [ ] Implement `importCodexSessionsToInbox(options)`.
- [ ] Require `options.inboxDir`; do not guess the Locus inbox path inside `packages/codex`.
- [ ] Allow `options.sessionsDir` to be omitted; resolve it through `resolveCodexSessionsDir()`.
- [ ] Flow: discover rollout files, parse JSONL, normalize records, apply capture gate, map to `InboxEvent v1`, write inbox files, return metrics.
- [ ] `metadata` mode writes only structural events.
- [ ] `full` mode writes prompt and assistant events after redaction pass.
- [ ] One bad file does not stop import.
- [ ] Missing sessions directory returns zero metrics.
- [ ] Cross-run DB duplicate metrics are deferred to Phase 2 MCP tool.
- [ ] Validate: `npm test -- packages/codex/tests/importer.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "feat(codex): import session JSONL into inbox"`.

### Task 11: Core Ingest Compatibility Test

**Files:** `packages/codex/tests/core-compat.test.ts`

- [ ] Inspect existing helpers: `rg -n "createTestDb|processInbox|new.*Adapter" packages/core/tests`.
- [ ] Write a test that imports Codex fixtures into temp inbox with `captureMode: "full"`.
- [ ] Pass the generated inbox to `processInbox()` from `packages/core/src/ingest/pipeline.ts`.
- [ ] Assert `errors === 0`, `processed > 0`, and stored rows have `source = "codex"`.
- [ ] Add duplicate assertion: run importer twice before `processInbox()` and assert `duplicatePending > 0`.
- [ ] Run `processInbox()` twice and assert the second run does not create new stored events.
- [ ] Validate: `npm test -- packages/codex/tests/core-compat.test.ts`.
- [ ] Validate: `npm run typecheck`.
- [ ] Commit: `git commit -m "test(codex): verify core ingest compatibility"`.

### Task 12: Documentation Update

**Files:** `docs/roadmap/codex.md`, `packages/codex/README.md`

- [ ] Link this implementation plan from `docs/roadmap/codex.md`.
- [ ] Document `LOCUS_CODEX_CAPTURE=off|metadata|redacted|full` in `packages/codex/README.md`.
- [ ] State that `metadata` is the default and does not import user/assistant text.
- [ ] State Phase 1 limitation: library importer only; no `memory_import_codex` MCP tool yet.
- [ ] State Phase 2 handoff: MCP tool should call `importCodexSessionsToInbox()`.
- [ ] Clarify that Phase 1 proves `memory_timeline` compatibility programmatically through core ingest tests; user-visible manual timeline inspection comes in Phase 2 after `memory_import_codex`.
- [ ] Validate: `npm run lint`.
- [ ] Validate: `npm test`.
- [ ] Commit: `git commit -m "docs(codex): document JSONL adapter phase 1"`.

### Task 13: Full Validation And Phase 1 Checkpoint

**Files:** all modified files

- [ ] Run full validation: `npm run typecheck`.
- [ ] Run full validation: `npm run lint`.
- [ ] Run full validation: `npm test`.
- [ ] Run full validation: `npm run build`.
- [ ] Verify no Claude changes: `git diff --name-only codex-baseline-2026-04-10..HEAD`.
- [ ] Expected: no paths under `packages/claude-code/**` or `claude-code/hooks/**`.
- [ ] Review final diff: `git diff --stat codex-baseline-2026-04-10..HEAD`.
- [ ] Review commit sequence: `git log --oneline codex-baseline-2026-04-10..HEAD`.
- [ ] Optional local checkpoint: `git tag -a codex-jsonl-phase-1-local -m "Codex JSONL adapter phase 1 local checkpoint"`.

---

## Risk Controls

- Privacy: `metadata` remains default and must not write user or assistant text.
- Compatibility: generated events must pass core `validateInboxEvent()`.
- Idempotency: deterministic IDs and pending-file duplicate skip prevent repeated pending inbox files.
- Schema drift: unknown Codex records are skipped and counted, never fatal.
- Claude safety: no Claude package or hook files are touched in Phase 1.
- Build coupling: `packages/codex` feeds core through JSON protocol, not runtime imports.

## Execution Guidance

Recommended execution mode:

- Use `@subagent-driven-development` only if the user explicitly wants subagents.
- Otherwise use `@executing-plans` inline in this session.

Commit after every task. Do not batch unrelated tasks into one commit. If real Codex JSONL shape differs from fixtures, stop and update fixtures/tests before implementation.
