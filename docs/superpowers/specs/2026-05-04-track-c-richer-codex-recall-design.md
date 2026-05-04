# Track C Design: Richer Codex Conversational Recall

**Date:** 2026-05-04
**Status:** Approved design, pending implementation plans
**Target release:** `v3.6` candidate
**Primary audience:** Locus maintainers and AI agents implementing Track C
**Primary product surface:** Codex CLI first, Codex desktop / extension second

---

## Purpose

Track C turns Locus from a working Codex memory pipeline into a richer recall
product. Track A made memory trustworthy enough to avoid misleading claims.
Track B made installation practical. Track C must make `redacted` capture useful
for real cross-session questions:

- "What did we decide about capture strategy?"
- "What did we do yesterday?"
- "Why did we reject hook-first capture?"
- "What is my preferred working style?"
- "What errors did we hit during npm install?"
- "What remains unfinished?"

The goal is not to store every transcript line. The goal is to keep a compact,
local, inspectable, privacy-aware memory that can recover the parts of a coding
conversation that matter.

---

## Current Baseline

The current implementation already has the right skeleton:

```text
Codex rollout JSONL -> normalize -> capture -> inbox -> conversation_events
conversation_events -> durable extractor -> durable_memories
memory_recall/search -> pre-query auto-import -> answer
```

The current weak points are quality issues, not fundamental architecture issues:

- `memory_recall` performs simple substring matching and has minimal ranking.
- Temporal parsing is limited to a few English phrases.
- Durable extraction only recognizes a narrow set of decision/style/constraint
  patterns.
- Topic keys are effectively limited to auth and database choices.
- `redacted` capture is useful but still too blunt for a strong product claim.
- Acceptance tests prove baseline recall, not broad semantic recall quality.

Track C strengthens these layers without forking the platform or breaking the
existing Codex install path.

---

## External Context

The design uses current Codex behavior as of 2026-05-04:

- Codex hooks are documented lifecycle hooks. Command hooks receive shared input
  such as `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`.
  Turn hooks also expose event-specific fields such as `prompt` for
  `UserPromptSubmit` and `last_assistant_message` for `Stop`.
- Codex plugins can bundle skills, MCP server configuration, and lifecycle hook
  config through plugin manifests.
- Codex `v0.128.0` improved plugin workflows, including marketplace
  installation, remote bundle caching, plugin-bundled hooks, and hook enablement
  state.
- Codex has its own Memories feature, but it is off by default, has regional
  availability limits, and stores generated state under `CODEX_HOME`. Locus
  remains valuable as a local, inspectable, MCP-accessible project memory layer.

References:

- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/plugins/build
- https://developers.openai.com/codex/memories
- https://github.com/openai/codex/releases/tag/rust-v0.128.0

---

## Architectural Decision

Keep Codex JSONL/transcript import as the canonical source of truth.

Codex hooks may be added as an optional freshness and trigger layer, but they
must not become the mandatory foundation for memory correctness in Track C.

Rationale:

- The existing Locus pipeline already validates JSONL/import/inbox/storage.
- Transcript-backed import can reconstruct richer context than isolated hook
  calls.
- Hooks are useful for timing and lightweight context, but hook behavior,
  enablement, timeouts, and platform quoting add operational risk.
- A failed hook must not make memory unusable. Pre-query auto-import must remain
  the fallback.

Target architecture:

```text
Codex JSONL/transcript
  -> @locus/codex normalize
  -> capture policy v2
  -> inbox writer
  -> core ingest
  -> conversation_events
  -> durable extractor v2
  -> durable_memories
  -> recall engine v2
  -> memory_recall

Optional hooks
  -> trigger refresh / add lightweight markers / add startup context
  -> never replace canonical import
```

---

## Non-Goals

Track C must not include:

- an HTML dashboard
- secondary IDE adapters such as Cursor or Windsurf
- a required LLM-based extraction pipeline
- automatic deletion of user memory without explicit confirmation
- Claude Code refactors unless a shared contract change truly requires it
- full parity claims for Codex desktop / extension until that surface is tested

---

## Component Design

### 1. Recall Engine v2

Create a focused recall layer instead of expanding `tools/recall.ts` into a
large all-purpose file.

Suggested modules:

- `recall/query-parser.ts`
- `recall/temporal-parser.ts`
- `recall/candidate-loader.ts`
- `recall/scoring.ts`
- `recall/grouping.ts`
- `recall/result-builder.ts`

Pipeline:

```text
question
  -> parse temporal range
  -> parse intent
  -> extract query terms and topic hints
  -> load durable candidates
  -> load conversation candidates
  -> score candidates
  -> group by session/topic/task
  -> return summary-first result
```

Required query understanding:

- English temporal phrases: `today`, `yesterday`, `last week`, `5 days ago`
- Russian temporal phrases: `сегодня`, `вчера`, `на прошлой неделе`,
  `5 дней назад`, `что делали в пятницу`
- Intent hints:
  - decisions: `what did we decide`, `что решили`
  - work summary: `what did we do`, `что делали`
  - bugs/errors: `errors`, `failures`, `ошибки`, `падало`
  - preferences/style: `my style`, `как я работаю`, `предпочтения`
  - rejected alternatives: `why not`, `why rejected`, `почему отказались`
  - next steps: `what remains`, `что осталось`
  - validation: `what passed`, `что проверено`

Scoring inputs:

- exact topic key match
- intent/memory type match
- query term overlap
- recency
- durable confidence
- source type priority
- capture reason priority
- session cohesion
- evidence count

Grouping behavior:

- If one strong group exists, return `status: "ok"`.
- If multiple plausible task groups exist, return `status:
  "needs_clarification"` with concise group headings.
- If no useful candidate exists, return `status: "no_memory"` and avoid
  pretending the answer was found.

Backward compatibility:

- Keep the existing top-level `MemoryRecallResult` shape valid.
- Add optional fields only, such as `matchedIntent`, `resolvedRange`,
  `candidateGroups`, `confidence`, and `matchedTopics`.

---

### 2. Capture Policy v2

`redacted` should become the practical recommended mode for rich Codex recall.
It must store more useful information than `metadata` without becoming
unbounded transcript hoarding.

Capture modes:

- `metadata`: diagnostic and minimal mode; weak recall by design.
- `redacted`: recommended rich recall mode; bounded snippets plus redaction.
- `full`: explicit opt-in; maximum recall with visible privacy warnings.

Capture improvements:

- Better noise filtering for off-topic learning, small talk, thanks-only turns,
  and generic questions.
- Better retention for decisions, preferences, style, constraints, rejected
  alternatives, validation facts, root causes, fix results, and next steps.
- Assistant responses should be retained when they contain high-value summary
  or decision content, not only next-step language.

Recommended capture reasons:

- `decision`
- `preference`
- `style`
- `constraint`
- `rejected_alternative`
- `validation_fact`
- `bug_context`
- `next_step`
- `release_context`
- `general_context`
- `noise`

Every retained event should expose enough metadata for later audit:

- `capturePolicy`
- `captureReason`
- `truncated`
- `retained`
- `filtered`
- `redactionApplied`

Redaction remains best-effort, not a DLP guarantee. The code and docs should
say this explicitly.

Redaction coverage should include at least:

- bearer tokens
- OpenAI-style `sk-` keys
- npm tokens
- GitHub tokens
- common `password`, `secret`, `token`, `api_key` assignments
- private key block markers

---

### 3. Durable Extractor v2

The durable extractor should remain local and deterministic in Track C.

Supported memory types:

- `decision`
- `preference`
- `style`
- `constraint`
- `rejected_alternative`
- `next_step`
- `validation_fact`

Extraction should use pattern families, not isolated one-off regexes:

- Decision markers: `decided`, `choose`, `confirmed`, `решили`, `выбрали`
- Rejection markers: `rejected`, `won't use`, `not suitable`,
  `отказались`, `не будем`, `не подходит`
- Preference markers: `I prefer`, `user prefers`, `мне удобнее`,
  `предпочитаю`
- Constraint markers: `must`, `do not`, `must not`, `нельзя`,
  `обязательно`, `не трогать`
- Validation markers: `passed`, `validated`, `verified`, `проверено`,
  `тесты прошли`
- Next-step markers: `next`, `todo`, `follow-up`, `осталось`,
  `следующий шаг`

Each candidate should carry:

- `memoryType`
- `summary`
- `topicKey`
- `sourceEventId`
- `sessionId`
- `timestamp`
- `matchedPattern`
- `confidence`
- `reason`
- supporting evidence fields

Confidence policy:

- High-confidence candidates can become active durable memories.
- Low-confidence candidates should be ignored or surfaced for review, not
  silently promoted.
- Repeated medium-confidence evidence may promote a durable memory if the merge
  layer can do this safely.

---

### 4. Topic Key Registry

Replace the narrow hardcoded topic-key logic with a registry.

Goals:

- stable topic keys for supersede semantics
- less accidental collision
- clearer review and audit output

Example topic keys:

- `capture_strategy`
- `install_strategy`
- `codex_hooks_strategy`
- `recall_engine_design`
- `user_workflow_style`
- `privacy_capture_mode`
- `release_validation`
- `database_choice`
- `auth_strategy`

Merge semantics:

- Exact normalized duplicate confirms existing memory.
- `decision`, `preference`, `constraint`, and `next_step` may supersede prior
  active entries when the topic key matches.
- `rejected_alternative` should not automatically supersede. It exists to stop
  agents from revisiting already rejected paths.
- Topic-key collisions must prefer keeping both entries over deleting useful
  context.

---

### 5. Inspectability And User Trust

Richer memory needs stronger transparency.

Improve review and audit surfaces so users can answer:

- What did Locus store?
- Why was it stored?
- Which event/session produced it?
- Was it redacted or truncated?
- Is it active, stale, superseded, or archivable?
- How do I remove it?

Target surfaces:

- `memory_review`
- `memory_audit`
- `memory_status`
- `memory_doctor`

Recommended additions:

- filter by memory type
- filter by confidence
- show `topicKey`
- show `sourceEventId`
- show `captureReason`
- show `whyStored`
- expose storage/capture warnings in human-readable form

No automatic cleanup should run without explicit user confirmation.

---

### 6. Optional Codex Hooks

Hooks are optional in Track C.

Candidate hook uses:

- `SessionStart`: add lightweight developer context telling Codex that Locus is
  available and should be checked before saying it does not remember.
- `UserPromptSubmit`: optionally record a lightweight pending marker or trigger
  a fast pre-query refresh.
- `Stop`: trigger post-turn import/extraction using `transcript_path` or
  `session_id`.

Avoid in Track C:

- using `PostToolUse` as a broad capture source
- blocking prompts or tool calls for memory reasons
- storing heavy content directly from hooks
- making hook success required for recall correctness

Install UX:

- Keep `locus-memory install codex` focused on MCP + skill + redacted capture.
- Add hooks only through an explicit flag or clearly documented optional mode.
- `doctor codex` should report hook status when hook support exists.

Failure behavior:

- hook failures fail open
- hook timeout must be short
- hook failure must not corrupt memory
- pre-query auto-import remains the recovery path

---

## Acceptance Requirements

Track C is not complete until redacted-mode fixtures prove useful recall.

Required fixture scenarios:

1. Multi-task temporal recall:
   - User asks in Russian: `что мы делали вчера?`
   - Result groups multiple tasks and asks for clarification.
2. Decision recall:
   - User asks: `что решили по capture strategy?`
   - Result returns active decision plus evidence.
3. Rejected alternative recall:
   - User asks: `почему отказались от hook-first?`
   - Result returns the rejected alternative and rationale.
4. Style/preference recall:
   - User asks: `какой у меня стиль работы?`
   - Result prioritizes durable `style` or `preference`.
5. Bug/error recall:
   - User asks: `какие ошибки были при npm install?`
   - Result finds the relevant bug/context group.
6. Next-step recall:
   - User asks: `что осталось сделать?`
   - Result returns durable or grouped next steps.
7. Validation recall:
   - User asks: `что реально проверено?`
   - Result returns validation facts, not aspirational plans.
8. Redaction safety:
   - Redacted mode must redact representative secrets and keep useful context.
9. Noise filtering:
   - Off-topic learning and small-talk turns must not dominate recall.
10. Backward compatibility:
   - Existing Track A recall tests must continue to pass.

---

## Test Strategy

Unit tests:

- temporal parser RU/EN
- intent parser RU/EN
- scoring and grouping
- redaction patterns
- relevance classification
- extractor pattern families
- topic-key registry
- merge/supersede rules

Integration tests:

- import redacted Codex fixtures
- process inbox
- run durable extraction
- call `memory_recall`
- assert summary/status/groups/evidence

Regression tests:

- `metadata` remains diagnostic/minimal
- `full` still warns
- existing `memory_search`, `memory_timeline`, `memory_import_codex`, and Track A
  acceptance behavior remains valid

Runtime validation before release:

- run `npm run check`
- run focused Codex tests
- run real local Codex recall smoke test in redacted mode
- verify `memory_status`, `memory_doctor`, `memory_review`, and `memory_audit`
  tell the same story

---

## Documentation Requirements

Update docs only as features land. Do not mark Track C as shipped during the
planning/spec phase.

Docs that will likely need updates during implementation:

- `README.md`
- `docs/roadmap/codex-next.md`
- `docs/codex-acceptance-matrix.md`
- Codex install/usage docs
- capture/privacy docs
- plugin skill instructions

Documentation truth rules:

- Do not claim semantic recall quality without fixture and runtime validation.
- Keep `metadata`, `redacted`, and `full` behavior clearly separated.
- Say redaction is best-effort.
- Say hooks are optional if they ship as optional.
- Keep Codex desktop / extension parity honest until tested.

---

## Implementation Plan Decomposition

Create separate implementation plans after this spec is reviewed:

- `C1` Recall Engine v2:
  - temporal parser
  - intent parser
  - candidate loading
  - scoring
  - grouping
  - backward-compatible result shape
- `C2` Capture/Relevance v2:
  - richer capture reasons
  - better noise filtering
  - assistant summary retention
  - redaction improvements
- `C3` Durable Extractor v2:
  - pattern families
  - topic-key registry
  - confidence/evidence
  - merge/supersede semantics
- `C4` Inspectability:
  - review/audit/status/doctor improvements
  - user-visible why-stored output
  - cleanup guidance without automatic deletion
- `C5` Optional Codex Hooks:
  - hook config design
  - install flag or plugin packaging
  - doctor diagnostics
  - fail-open behavior
- `C6` Acceptance And Docs Truth Pass:
  - real fixture matrix
  - docs updates
  - local runtime recall smoke test
  - release-readiness checklist

Each plan should be executable task-by-task with approval gates, tests, docs,
and git checkpoints.

---

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Recall becomes noisy | Scoring, grouping, capture reasons, and noise fixtures |
| Redacted stores too little | Assistant high-value retention and richer relevance rules |
| Redacted stores too much | Bounded snippets, better noise filtering, audit/review tools |
| Topic keys collide | Registry with conservative supersede behavior |
| RU/EN parsing grows messy | Keep parser deterministic and fixture-driven |
| Hooks add fragility | Keep hooks optional, short-timeout, fail-open |
| Token cost grows | Keep extraction local rule-based in Track C |
| Docs overpromise again | Acceptance matrix gates README/release claims |

---

## Open Questions For Implementation Plans

These do not block the design:

- Should low-confidence candidates be dropped or stored as review-only rows?
- Should hook support land in `v3.6.0` or be allowed to slip to `v3.6.x`?
- Should `redacted` snippet limits change globally or per capture reason?
- Should `memory_recall` expose `candidateGroups` immediately or only after
  internal grouping stabilizes?

---

## Success Definition

Track C is successful when a normal Codex user with one-command install and
`redacted` capture can ask natural RU/EN questions about recent work, decisions,
style, rejected alternatives, errors, next steps, and validation, and Locus can
answer from local memory with evidence and without pretending that unvalidated
memory exists.
