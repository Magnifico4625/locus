# Codex Acceptance Matrix

This matrix records what the current Track A acceptance tests prove for Codex memory.

It separates three different claims:

- **Import health** — Codex session events can be discovered and ingested.
- **Useful recall** — `memory_recall` can answer with meaningful recent context or durable decisions.
- **Surface parity** — the same behavior is validated in a specific Codex runtime surface.

## Current Validation

| Surface | Status | Validated behavior | Known limitation |
|---------|--------|--------------------|------------------|
| Codex CLI | Validated primary path | Auto-import before `memory_search`, manual `memory_import_codex`, `memory_status`, `memory_doctor`, `memory_recall`, fixture-backed recent bugfix recall, durable decision candidate recall, live local recall marker `TRACKA-LIVE-20260423` on Codex CLI `0.123.0` | Strong conversational recall requires `LOCUS_CODEX_CAPTURE=redacted` or `full`; `metadata` is limited recall; duplicate-heavy recall can return `needs_clarification` |
| Codex desktop / extension | Unverified parity | Same MCP config model may expose the same Locus tools when the upstream surface supports MCP | Extension-side MCP visibility and behavior can differ from CLI; diagnostics must report this honestly |
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

Track A acceptance considers recall successful when:

- Codex CLI can recover useful recent context from a real fixture-backed session.
- Codex CLI can recover useful local live dialogue from payload-wrapped rollout JSONL in `redacted` mode.
- Durable decisions appear in recall candidates.
- Multiple plausible matches may return `needs_clarification`; that is valid if the durable or conversation candidate is present and inspectable.
- `memory_status` exposes `codexTruth` so agents can distinguish import health from recall usefulness.
- `memory_doctor` warns when `metadata` is too weak for strong recall and when desktop/extension parity is unverified.

## Verification Commands

The focused Track A acceptance checks are:

```bash
npm test -- packages/core/tests/integration/track-a-recall-acceptance.test.ts packages/core/tests/integration/track-a-desktop-diagnostics.test.ts
npm test -- packages/core/tests/tools/doctor.test.ts packages/core/tests/tools/status.test.ts
```
