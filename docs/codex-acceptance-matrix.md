# Codex Acceptance Matrix

This matrix records what the current Track A, Track B, Track C, and Track D checks prove for Codex memory.

It separates three different claims:

- **Import health** — Codex session events can be discovered and ingested.
- **Useful recall** — `memory_recall` can answer with meaningful recent context or durable decisions.
- **Surface parity** — the same behavior is validated in a specific Codex runtime surface.

## Current Validation

| Surface | Status | Validated behavior | Known limitation |
|---------|--------|--------------------|------------------|
| Codex CLI | Validated primary path | Auto-import before `memory_search`, manual `memory_import_codex`, `memory_status`, `memory_doctor`, `memory_recall`, fixture-backed recent bugfix recall, durable decision candidate recall, live local recall marker `TRACKA-LIVE-20260423` on Codex CLI `0.123.0`, local one-command installer smoke on Codex CLI `0.125.0`, Track C redacted recall fixtures through `track-c-recall-acceptance.test.ts`, and Track D full local gate through `npm run check` / `npm run build` | Strong conversational recall requires `LOCUS_CODEX_CAPTURE=redacted` or `full`; `metadata` is limited recall; duplicate-heavy recall can return `needs_clarification`; agents must use `candidateGroups` for focused clarification |
| Codex desktop / extension | Desktop MCP marker path accepted; extension parity pending | Same MCP config model may expose the same Locus tools when the upstream surface supports MCP. Track D validates desktop marker import/recall/doctor status when `LOCUS_CODEX_SURFACE=desktop` is set and retained Codex events exist. D8 local smoke confirmed the configured Desktop CLI MCP entry points at this repo's `dist/server.js`. | `LOCUS_CODEX_SURFACE` is a diagnostic override and can mislead if left set accidentally; an already-running Desktop session can keep the previous MCP tool registry until reload; extension-side MCP visibility and behavior can differ from CLI |
| One-command npm install | Validated for Codex CLI via npm package | `locus-memory install codex`, `doctor codex`, and `uninstall codex` are implemented with skill install, lock handling, idempotency, redacted defaults, package-runtime config generation, and safe MCP `cwd` handling | Codex desktop / extension install parity still requires target-surface validation |
| Manual MCP fallback | Supported fallback | Direct MCP server setup works with all Locus tools/resources where the client exposes MCP | Passive Codex JSONL import still depends on `CODEX_HOME`, readable `sessions/`, and capture mode |
| Secondary IDE adapters | Future work | Generic MCP tools/resources work where the client supports MCP | Passive conversation capture for Cursor/Windsurf-style clients is not validated in Track A |

## Capture Mode Expectations

| Mode | Recall readiness | What it means | Recommended use |
|------|------------------|---------------|-----------------|
| `off` | Disabled | Codex JSONL import is disabled | Only for users who do not want Codex session capture |
| `metadata` | Limited | Imports structural session/tool events and diagnostics, but not enough dialogue for strong conversational memory | Safe diagnostics-first mode, not the recommended mode for useful Codex recall |
| `redacted` | Practical | Stores bounded, filtered, best-effort-redacted snippets plus durable high-value facts | Recommended Codex mode for useful recall |
| `full` | Maximum | Stores raw conversation text after best-effort redaction | Explicit opt-in only; do not describe as risk-free |

## Accepted Recall Contract

Track C/D acceptance considers recall successful when:

- Codex CLI can recover useful recent context from a real fixture-backed session.
- Codex CLI can recover useful local live dialogue from payload-wrapped rollout JSONL in `redacted` mode.
- Durable decisions, rejected alternatives, style/preferences, next steps, and validation facts appear in recall candidates.
- Russian dated questions such as "что мы делали вчера?" can recover relevant redacted context.
- Multiple plausible matches may return `needs_clarification`; that is valid if the durable or conversation candidate is present, inspectable, and grouped through `candidateGroups`.
- `memory_status` exposes `codexTruth` so agents can distinguish import health from recall usefulness.
- `memory_status` exposes `codexFreshness` so agents can compare the newest rollout event timestamp with the newest imported Codex event.
- `memory_project_state` exposes the current project root/hash, package metadata, git state, latest conversation timestamp, active durable count, and active next steps.
- `memory_calendar` is the recommended first tool for broad period questions; it defaults to `last_30d`, so agents should pass `this_month`, `last_month`, or an explicit range for user period questions.
- Date-scoped `memory_recall` exposes searched date buckets and keeps current-project recall isolated from other project memories unless the user asks for global recall.
- Track D fixture acceptance validates current-project month recall without ProxyVpn noise, `memory_calendar` pre-query auto-import, and Codex Desktop marker recall when `LOCUS_CODEX_SURFACE=desktop`.
- `memory_doctor` warns when `metadata` is too weak for strong recall, reports Codex import freshness lag, and keeps desktop/extension parity honest.

`LOCUS_CODEX_SURFACE=desktop|extension|cli` is a diagnostic/debug override for validating non-CLI surfaces before stronger upstream evidence exists. It can intentionally simulate a surface, but it can also mislead `memory_status` and `memory_doctor` if left set accidentally.

Evidence anchors remain a Track D follow-up: current candidates expose source event IDs, durable IDs, project roots, and date metadata; richer user-facing commit/file/command evidence formatting can ship after the project-scoped behavior is proven.

## Verification Commands

The focused Track C/D acceptance checks are:

```bash
npm test -- packages/core/tests/recall packages/core/tests/tools/recall.test.ts packages/core/tests/tools/calendar.test.ts packages/core/tests/tools/project-state.test.ts packages/core/tests/tools/status.test.ts packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/codex-diagnostics.test.ts packages/core/tests/integration/track-d-memory-reliability.test.ts packages/codex/tests
npm test -- packages/core/tests/integration/track-c-recall-acceptance.test.ts packages/core/tests/integration/track-a-recall-acceptance.test.ts
npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts
npm test -- packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts
npm test -- packages/core/tests/integration/track-d-memory-reliability.test.ts
npm test -- packages/codex/tests/skill-contract.test.ts packages/codex/tests/skill-sync.test.ts
npm run check
npm run build
```
