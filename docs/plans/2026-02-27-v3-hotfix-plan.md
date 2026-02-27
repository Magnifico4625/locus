# Locus v3 "Carbon Copy" — Hotfix Plan

**Goal:** Fix 10 audit findings discovered during post-implementation review of the Carbon Copy feature (Tasks 1-18). All findings were verified against source code and confirmed.

**Branch:** `feat/v3-carbon-copy` (before merge to main)

**Audit source:** External review (GPT) cross-referenced with codebase by Opus 4.6.

**Design doc:** `docs/plans/2026-02-25-carbon-copy-design.md`
**Implementation plan:** `docs/plans/2026-02-25-carbon-copy-implementation.md`

---

## Audit Findings Summary

| # | Finding | Severity | Verified |
|---|---------|----------|----------|
| 1 | Secrets written to disk before redaction in hooks | Critical | Yes |
| 2 | `memory_purge` does not clean Carbon Copy tables | Critical | Yes |
| 3 | Byte offset vs string index mismatch in Stop hook tailer | Critical | Yes |
| 4 | Project root mismatch between core (markers) and hooks (git-only) | Critical | Yes |
| 5 | CaptureLevel `redacted` not implemented per design doc | Critical | Yes |
| 6 | File denylist not applied to conversation ingest pipeline | Critical | Yes |
| 7 | LIKE escaping incorrect in similarity dedup | Serious | Yes |
| 8 | No per-file error isolation in ingest store phase | Serious | Yes |
| 9 | `source_event_id` never set by hooks (idempotency broken) | Serious | Yes |
| 10 | README/design doc claims don't match implementation | Docs | Yes |

---

## Conventions

- **TDD:** Write failing test, verify failure, implement, verify pass
- **Biome:** Single quotes, semicolons, trailing commas, 100 char line width, spaces indent 2
- **Tests:** `vitest` with `describe`/`it`, colocated in `tests/` mirror of `src/`
- **Commits:** Conventional commits (`fix:`, `feat:`, `docs:`)
- **Hooks:** Plain JS (not TypeScript), standalone, never crash (try/catch everything)
- **Safe subprocess calls:** Use `execFileSync` with array args (prevents shell injection)

---

## Task Groups

5 task groups, organized by component to minimize cross-file conflicts:

| Task | Group | Findings | Complexity | Agent |
|------|-------|----------|------------|-------|
| **A** | Hook Layer | #4, #1, #9, #3 | High | Opus (main) |
| **B** | Pipeline Layer | #6, #7, #8 | Medium | **Sonnet subagent** |
| **C** | Purge | #2 | Low | **Sonnet subagent** |
| **D** | CaptureLevel `redacted` | #5 (full impl) | High | Opus (main) |
| **E** | Documentation | #10 | Low | **Sonnet subagent** |

**Dependency graph:**

```
  A (hooks) ────────→ D (redacted) ────→ E (docs)
  B (pipeline) ──────────────────────────┘
  C (purge) ─────────────────────────────┘
```

A, B, C can run in parallel. D depends on A (shared.js + redact.js). E runs last (needs final file state).

---

## Task A: Hook Layer Fixes (#4, #1, #9, #3)

**Agent:** Opus (main) — 4 interconnected fixes in shared hook files.

Internal order: A1 → A2 → A3 → A4 (each builds on previous).

### Task A1: Port project markers to shared.js (Fix #4)

**Finding:** `shared.js:resolveProjectRoot()` uses only `git rev-parse` + cwd fallback.
Core (`project-root.ts:83-110`) also walks up to find project markers (package.json, Cargo.toml, etc.).
In non-git projects, hooks and core compute different project roots → different hashes → inbox path mismatch.

**Solution:** Port walk-up logic from `project-root.ts` into `shared.js` as plain JS.

**Algorithm:**
```
resolveProjectRoot(cwd):
  1. git rev-parse --show-toplevel → if ok, return normalized path
  2. Walk up from cwd to filesystem root:
     - For each dir, check PROJECT_MARKERS list
     - Remember HIGHEST marker dir (closest to FS root)
  3. If marker dir found → return it
  4. Else → return cwd
```

**Files:**
- Modify: `packages/claude-code/hooks/shared.js`
  - Add `PROJECT_MARKERS` array (same 12 patterns as `packages/core/src/project-root.ts:8-21`)
  - Add `hasAnyMarker(dir, markers)` — `existsSync` check + `readdirSync` for glob patterns like `*.sln`
  - Replace `resolveProjectRoot(cwd)` implementation with git → markers → cwd algorithm

**Tests** (new cases in `packages/core/tests/hooks/shared.test.ts`):
- Non-git project with `package.json` in parent dir → resolves to marker dir
- Nested subdirectory → finds highest marker (closest to FS root)
- No markers, no git → returns cwd
- Git project → still returns git root (unchanged behavior)

**Commit:** `fix: port project markers to hook resolveProjectRoot`

---

### Task A2: Hook-level secret redaction (Fix #1)

**Finding:** Hooks write raw prompt text and AI responses to inbox JSON files without redaction.
`user-prompt.js:53` writes `prompt` as-is, `stop.js:222` writes `msg.text` as-is.
README:146 claims "Redaction is applied twice: once in hooks before writing to disk" — this is false.
Secrets can persist in `~/.claude/memory/locus-<hash>/inbox/` if MCP server crashes before processing.

**Solution:** Create `packages/claude-code/hooks/redact.js` — plain JS port of redaction patterns from `packages/core/src/security/redact.ts`.

**New file: `packages/claude-code/hooks/redact.js`**

Port all 8 REDACT_PATTERNS from `redact.ts:8-47`:
1. Private key blocks (multiline)
2. `sk-` prefixed API keys (20+ chars)
3. `pk-` prefixed keys
4. `ghp_` / `gho_` GitHub tokens (36+ chars)
5. `glpat-` GitLab tokens
6. `xox[bpas]-` Slack tokens
7. `AKIA` AWS access keys (16 uppercase alphanum)
8. Connection strings (`postgres://`, `mysql://`, etc.)
9. Bearer tokens (20+ chars)
10. Generic `KEY=VALUE` pattern (8+ char values)

Export: `function redact(text) { ... }`

**Hook modifications:**
- `user-prompt.js`: `payload.prompt = redact(prompt)` before `writeAtomicInboxEvent()`
- `stop.js`: `payload.response = redact(msg.text)` before `writeAtomicInboxEvent()`
- `post-tool-use.js`: `payload.bashCommand = redact(cmd)` when captureLevel=full

**Files:**
- Create: `packages/claude-code/hooks/redact.js`
- Modify: `packages/claude-code/hooks/user-prompt.js`
- Modify: `packages/claude-code/hooks/stop.js`
- Modify: `packages/claude-code/hooks/post-tool-use.js`
- Create: `packages/core/tests/hooks/redact.test.ts`

**Tests:**
- `redact('my key sk-abc123...(20+ chars)')` → `'my key sk-[REDACTED]'`
- All 8 pattern types — mirror of `tests/security/redact.test.ts`
- Integration test: write inbox event → file on disk does not contain raw secret
- Verify patterns are identical to core `redact.ts` (same regex, same replacement strings)

**Commit:** `fix: add hook-level secret redaction before inbox write`

---

### Task A3: Deterministic source_event_id (Fix #9)

**Finding:** All hooks generate random UUID (`crypto.randomUUID()`) for `event_id`. No hook sets
`source_event_id`. The unique index `idx_il_source ON ingest_log(source, source_event_id)` is useless
(all NULL). On retry/crash recovery, duplicate events are created with new UUIDs.

**Solution:** Compute deterministic `source_event_id` from stable event data.

| Hook | source_event_id formula |
|------|------------------------|
| `user-prompt.js` | `sha256(session_id + timestamp + prompt.slice(0,200))` → first 16 hex |
| `stop.js` | `sha256(session_id + transcript_path + lastOffset)` → first 16 hex |
| `post-tool-use.js` | `sha256(session_id + timestamp + tool_name + JSON.stringify(filePaths))` → first 16 hex |

**Files:**
- Modify: `packages/claude-code/hooks/shared.js`
  - Add: `function computeSourceEventId(...parts)` — `sha256(parts.join(':'))` first 16 hex chars
- Modify: `packages/claude-code/hooks/user-prompt.js` — add `inboxEvent.source_event_id = computeSourceEventId(...)`
- Modify: `packages/claude-code/hooks/stop.js` — add `inboxEvent.source_event_id = computeSourceEventId(...)`
- Modify: `packages/claude-code/hooks/post-tool-use.js` — add `inboxEvent.source_event_id = computeSourceEventId(...)`

**Tests:**
- Same input data → same source_event_id (deterministic)
- Different input data → different source_event_id
- source_event_id is 16 hex chars
- Pipeline dedup: two inbox files with same source_event_id → only one stored

**Commit:** `fix: add deterministic source_event_id to all hooks`

---

### Task A4: Buffer byte slice for transcript tailer (Fix #3)

**Finding:** `stop.js:180` saves `statSync(transcriptPath).size` (bytes) as offset.
`stop.js:198` does `fullContent.slice(lastOffset)` where `fullContent` is a UTF-8 string.
For multi-byte characters (Cyrillic = 2 bytes, emoji = 4 bytes), byte offset ≠ string character index.
Result: offset drift → skipped messages or duplicate extraction.

**Solution:** Read file as Buffer, byte-slice, then decode to string.

```js
// Before (broken):
const fullContent = readFileSync(transcriptPath, 'utf-8');
const newContent = fullContent.slice(lastOffset);

// After (correct):
const buffer = readFileSync(transcriptPath);       // Buffer (raw bytes)
const newBytes = buffer.subarray(lastOffset);       // byte-level slice
const newContent = newBytes.toString('utf-8');       // decode after slicing
```

Save `buffer.length` (bytes) to tailer-state for consistency with the read approach.

**Files:**
- Modify: `packages/claude-code/hooks/stop.js`

**Tests** (new cases in `packages/core/tests/hooks/stop.test.ts`):
- Transcript with Cyrillic characters (2-byte UTF-8) → correct read from byte offset
- Transcript with emoji (4-byte UTF-8) → no offset drift
- Offset after first read = file byte size (not string length)
- Second read after append → reads only new content

**Commit:** `fix: use Buffer byte slice for transcript tailer offset`

---

## Task B: Pipeline Layer Fixes (#6, #7, #8)

**Agent:** Sonnet subagent — 3 isolated fixes in `pipeline.ts` and `filters.ts`.
All fixes are independent from each other and from Task A hooks.

### Task B1: File denylist in conversation ingest (Fix #6)

**Finding:** `pipeline.ts:142-146` stores file paths from events to `event_files` table without
checking against the file denylist. Paths like `.env`, `credentials.json`, `*.key` are indexed.
`extractFtsContent()` also includes denied file paths in FTS index.
README:145 claims denied files are "never indexed" — this is false for conversation ingest.

**Solution:** Import `isDenylisted` from `security/file-ignore.ts` and filter paths before storage.

**Changes in `packages/core/src/ingest/pipeline.ts`:**

1. Add import: `import { isDenylisted } from '../security/file-ignore.js';`

2. Filter in store phase (line 142):
```ts
const filePaths = extractFilePaths(event).filter(fp => !isDenylisted(fp));
```

3. Filter in `extractFtsContent()` for tool_use files:
```ts
case 'tool_use': {
  const files = payload.files;
  if (Array.isArray(files)) {
    for (const f of files) {
      if (typeof f === 'string' && !isDenylisted(f)) parts.push(f);
    }
  }
}
```

4. Filter in `extractFtsContent()` for file_diff path:
```ts
case 'file_diff': {
  const path = typeof payload.path === 'string' ? payload.path : '';
  if (path && !isDenylisted(path)) parts.push(path);
}
```

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`
- Test: `packages/core/tests/ingest/pipeline-store.test.ts` (new cases)

**Tests:**
- Event with `files: ['.env', 'src/app.ts']` → event_files contains only `src/app.ts`
- FTS content does not contain `.env`
- Event with `kind: 'file_diff', path: 'secrets/key.pem'` → event_files is empty
- Event with `kind: 'file_diff', path: '.env.production'` → filtered out
- Non-denied paths pass through unchanged

**Commit:** `fix: apply file denylist to conversation ingest pipeline`

---

### Task B2: Correct LIKE escaping in similarity dedup (Fix #7)

**Finding:** `filters.ts:136-137` `escapeForLike()` replaces `%` with `%%` and `_` with `__`.
In SQLite LIKE, `%%` is two wildcards (still matches anything), `__` matches exactly 2 characters.
This causes false positive dedup matches for paths containing `_` (e.g., `my_component.ts`).

**Solution:** Use proper ESCAPE clause with backslash escaping.

**Changes in `packages/core/src/ingest/filters.ts`:**

1. Fix `escapeForLike()`:
```ts
function escapeForLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
```

2. Update SQL queries in `dedupPrompt()` and `dedupFileDiff()`:
```sql
-- Before:
AND payload_json LIKE ?

-- After:
AND payload_json LIKE ? ESCAPE '\\'
```

> Note: In the JS/TS string, `ESCAPE '\\\\'` produces the SQL literal `ESCAPE '\\'`
> which tells SQLite to use `\` as the escape character. This is the standard
> SQLite approach for LIKE escaping.

**Files:**
- Modify: `packages/core/src/ingest/filters.ts`
- Test: `packages/core/tests/ingest/filters.test.ts` (new cases)

**Tests:**
- Prompt containing `_` (`my_var is broken`) → dedup matches only exact `my_var`, not `myXvar`
- Prompt containing `%` (`100% done`) → does not match arbitrary text
- Path with `_` (`src/my_component.ts`) → exact match only
- Existing dedup tests still pass (regression check)

**Commit:** `fix: correct LIKE escape in similarity dedup`

---

### Task B3: Per-file error isolation in ingest store (Fix #8)

**Finding:** `pipeline.ts:122` `db.run(INSERT INTO conversation_events...)` has no try/catch.
If INSERT throws (constraint violation on race condition, disk full, etc.), the entire
`processInbox()` loop aborts. Remaining files in inbox are not processed until next invocation.
The FTS INSERT (line 153) has a try/catch, but main INSERT and event_files INSERTs do not.

**Solution:** Wrap the entire transform+store phase in try/catch per file.

**Changes in `packages/core/src/ingest/pipeline.ts`:**

Move lines 118-169 (Phase 3: TRANSFORM + Phase 4: STORE) into a try/catch block:

```ts
// Phase 3-4: TRANSFORM + STORE — isolated per file
try {
  const payloadJson = redact(JSON.stringify(event.payload));
  const result = db.run(`INSERT INTO conversation_events ...`, [...]);

  const filePaths = extractFilePaths(event).filter(fp => !isDenylisted(fp));
  for (const fp of filePaths) {
    db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [event.event_id, fp]);
  }

  if (fts5) { /* FTS insert — already has its own try/catch */ }

  recordProcessed(db, event);
  tryDelete(filePath);
  metrics.processed++;
} catch {
  metrics.errors++;
  // File stays in inbox for retry on next processInbox() run.
  // No partial state: recordProcessed() is last before tryDelete(),
  // so if INSERT fails, ingest_log is not written, and next run
  // will not see this event as already processed.
}
```

**Key invariant:** `recordProcessed()` is called AFTER all INSERTs but BEFORE `tryDelete()`.
If any INSERT fails, `recordProcessed` is not called → next run retries the event.
If `recordProcessed` succeeds but `tryDelete` fails → next run sees the event in ingest_log
as duplicate and safely skips it.

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`
- Test: `packages/core/tests/ingest/pipeline-store.test.ts` (new cases)

**Tests:**
- 3 events, middle one causes INSERT error → 2 processed, 1 error
- Failed event's inbox file remains on disk
- `metrics.errors` correctly incremented
- Failed event can be retried on next processInbox() call

**Commit:** `fix: isolate store errors per file in ingest pipeline`

---

## Task C: Purge Fix (#2)

**Agent:** Sonnet subagent — single function modification.

### Task C1: Purge Carbon Copy tables and inbox (Fix #2)

**Finding:** `purge.ts:81-84` only deletes from 4 v1 tables: `files`, `memories`, `hook_captures`,
`scan_state`. The v3 tables (`conversation_events`, `event_files`, `conversation_fts`, `ingest_log`)
are not cleaned. UI/README describe purge as "clear all project memory."

**Solution:** Add v3 table cleanup + inbox directory cleanup.

**Changes in `packages/core/src/tools/purge.ts`:**

1. Add imports: `import { readdirSync, unlinkSync } from 'node:fs';` and `import { join } from 'node:path';`

2. Extend PurgeDeps interface:
```ts
export interface PurgeDeps {
  db: DatabaseAdapter;
  dbPath: string;
  projectPath: string;
  tokenStore: ConfirmationTokenStore;
  inboxDir?: string;  // optional for backward compat
}
```

3. Update stats gathering (first call) — add conversation events count:
```ts
const convRow = deps.db.get<CountRow>('SELECT COUNT(*) AS cnt FROM conversation_events');
const conversationEvents = convRow?.cnt ?? 0;
```

Update message to include conversation events:
```ts
const message =
  `This will delete ALL memory for ${deps.projectPath}. ` +
  `${files} files, ${memories} decisions, ${episodes} episodes, ` +
  `${conversationEvents} conversation events. ` +
  `This cannot be undone.`;
```

Update stats object: `stats: { files, memories, episodes, conversationEvents, dbSizeBytes }`

4. Add v3 table cleanup after existing DELETE statements (line 84):
```ts
deps.db.run('DELETE FROM conversation_events');
deps.db.run('DELETE FROM event_files');
deps.db.run('DELETE FROM ingest_log');

// FTS cleanup — try/catch because table may not exist (no fts5 support)
try {
  deps.db.run('DELETE FROM conversation_fts');
} catch {
  // conversation_fts may not exist if FTS5 is not available
}
```

5. Clean inbox directory:
```ts
if (deps.inboxDir) {
  try {
    const inboxFiles = readdirSync(deps.inboxDir).filter(f => f.endsWith('.json'));
    for (const f of inboxFiles) {
      try { unlinkSync(join(deps.inboxDir, f)); } catch { /* best effort */ }
    }
  } catch {
    // Inbox dir may not exist
  }
}
```

6. Update PurgeStats type in `types.ts`:
```ts
export interface PurgeStats {
  files: number;
  memories: number;
  episodes: number;
  conversationEvents: number;  // new
  dbSizeBytes: number;
}
```

**Files:**
- Modify: `packages/core/src/tools/purge.ts`
- Modify: `packages/core/src/types.ts` (PurgeStats)
- Modify: `packages/core/src/server.ts` (pass inboxDir to PurgeDeps)
- Test: `packages/core/tests/tools/purge.test.ts` (new cases)

**Tests:**
- After purge: `SELECT COUNT(*) FROM conversation_events` = 0
- After purge: `SELECT COUNT(*) FROM event_files` = 0
- After purge: `SELECT COUNT(*) FROM ingest_log` = 0
- Stats include `conversationEvents` count
- Inbox .json files deleted after purge
- Backward compat: purge without inboxDir still works (no crash)

**Commit:** `fix: purge Carbon Copy tables and inbox files`

---

## Task D: CaptureLevel `redacted` Full Implementation (#5)

**Agent:** Opus (main) — most complex task, requires new RAKE module + hook coordination.
**Depends on:** Task A (needs shared.js changes, redact.js).

### Task D1: RAKE keyword extraction module

**Finding:** Design doc (line 222) specifies `redacted` level for user prompts as "keywords only".
Current implementation treats `redacted` identically to `full` — full prompt text is written.

**Solution:** Implement RAKE (Rapid Automatic Keyword Extraction) as a standalone JS module.

**Algorithm:**
1. Define stopwords set (~175 words: English common + programming terms)
2. Split input text into candidate phrases (split on stopwords and punctuation boundaries)
3. Build word co-occurrence: for each word compute `degree(word)` (sum of phrase lengths containing it) and `frequency(word)` (occurrence count)
4. Score each word: `score = degree / frequency`
5. Score each phrase: sum of word scores
6. Sort phrases by score descending
7. Return top N phrases (default N=10), joined by `, `

**New file: `packages/claude-code/hooks/keywords.js`**

```js
// Stopwords: English common words + programming keywords
const STOPWORDS = new Set([
  // English (150+)
  'the', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'as', 'into', 'this', 'that', 'it',
  'its', 'be', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'about',
  'up', 'out', 'all', 'also', 'how', 'what', 'when', 'where', 'which',
  'who', 'why', 'each', 'every', 'both', 'few', 'more', 'some', 'any',
  'most', 'other', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'she', 'they', 'them', 'their', 'him', 'her', 'us', 'am', 'being',
  'doing', 'during', 'before', 'after', 'above', 'below', 'between',
  'through', 'again', 'further', 'here', 'there', 'once', 'such',
  'only', 'same', 'own', 'now', 'get', 'got', 'go', 'make', 'made',
  'take', 'know', 'see', 'come', 'think', 'look', 'want', 'give',
  'use', 'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave',
  'call', 'need', 'become', 'keep', 'let', 'begin', 'show', 'hear',
  'play', 'run', 'move', 'like', 'live', 'believe', 'hold', 'bring',
  'happen', 'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet',
  'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand',
  'watch', 'follow', 'stop', 'create', 'speak', 'read', 'allow', 'add',
  'spend', 'grow', 'open', 'walk', 'win', 'offer', 'remember', 'love',
  'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect',
  'build', 'stay', 'fall', 'oh', 'yeah', 'ok', 'please', 'help',
  // Programming
  'function', 'return', 'const', 'let', 'var', 'import', 'export',
  'class', 'new', 'null', 'undefined', 'true', 'false', 'try', 'catch',
  'throw', 'async', 'await', 'void', 'type', 'interface', 'enum',
  'extends', 'implements', 'static', 'public', 'private', 'protected',
]);

/**
 * RAKE keyword extraction.
 * @param {string} text — input text
 * @param {number} [maxKeywords=10] — max phrases to return
 * @returns {string} comma-separated keywords
 */
export function extractKeywords(text, maxKeywords = 10) {
  if (!text || text.trim().length === 0) return '';

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return text.trim();  // too short for RAKE

  // 1. Split into candidate phrases (sequences of non-stopwords)
  // 2. Score words by co-occurrence
  // 3. Score phrases
  // 4. Return top N
  ...
}
```

**Files:**
- Create: `packages/claude-code/hooks/keywords.js`
- Test: `packages/core/tests/hooks/keywords.test.ts`

**Tests:**
- `extractKeywords('Fix the authentication bug in login flow')` → contains `authentication`, `bug`, `login flow`
- Stopwords filtered: `the`, `in` not present
- `extractKeywords('', 10)` → `''`
- Short text (< 3 words): returned as-is
- Max keywords respected: long text → at most 10 phrases
- Programming stopwords filtered: `function`, `return`, `const` excluded
- Unicode safe: Cyrillic text → extracts meaningful words

**Commit:** `feat: implement RAKE keyword extraction for redacted captureLevel`

---

### Task D2: CaptureLevel gates in hooks

**Changes per hook at `redacted` level:**

**`user-prompt.js`:**
```js
import { extractKeywords } from './keywords.js';
import { redact } from './redact.js';

// At redacted level: extract keywords only (NOT full prompt)
if (captureLevel === 'redacted') {
  inboxEvent.payload = {
    prompt: extractKeywords(redact(prompt)),
    redacted: true,  // marker for pipeline/UI
  };
}
// At full level: redacted full text
if (captureLevel === 'full') {
  inboxEvent.payload = {
    prompt: redact(prompt),
  };
}
```

**`stop.js`:**
```js
// At redacted level: ai_response is NOT captured (design doc: "NO")
if (captureLevel === 'redacted') {
  return undefined;  // exit early, don't write anything
}
// Only full level reaches writeAtomicInboxEvent
```

**`post-tool-use.js`:**
Already has correct metadata/redacted/full differentiation in `extractCapture()`:
- `metadata`: stats only (tool name, file paths, status, exit code, diff stats)
- `redacted`: + error_kind + first token of bash command
- `full`: + full bash command

Only change: apply `redact()` to `bash_command` at full level (Fix #1 already covers this).

**Files:**
- Modify: `packages/claude-code/hooks/user-prompt.js`
- Modify: `packages/claude-code/hooks/stop.js`
- `post-tool-use.js` changes already covered by Task A2

**Tests** (in respective test files):
- user-prompt at redacted: payload contains keywords, not full prompt
- user-prompt at redacted: `payload.redacted === true`
- stop at redacted: no inbox event written
- stop at full: event written with redacted response text
- post-tool-use at redacted: unchanged behavior (already correct)

---

### Task D3: Pipeline captureLevel gate update

**Changes in `packages/core/src/ingest/filters.ts`:**

Update `captureLevelGate()` to block `ai_response` at `redacted` level (second defense):

```ts
export function captureLevelGate(event: InboxEvent, captureLevel: CaptureLevel): boolean {
  if (captureLevel === 'metadata') {
    // Block content events: prompts and AI responses
    return event.kind !== 'user_prompt' && event.kind !== 'ai_response';
  }
  if (captureLevel === 'redacted') {
    // Block AI responses (second defense — hook should already skip)
    return event.kind !== 'ai_response';
  }
  // full: everything passes
  return true;
}
```

**Tests** (new cases in `filters.test.ts`):
- `captureLevelGate({ kind: 'ai_response' }, 'redacted')` → `false`
- `captureLevelGate({ kind: 'user_prompt' }, 'redacted')` → `true` (keywords already extracted)
- `captureLevelGate({ kind: 'tool_use' }, 'redacted')` → `true`
- Existing metadata tests unchanged

**Commit:** `feat: enforce captureLevel redacted gates in hooks and pipeline`

---

## Task E: Documentation Updates (#10)

**Agent:** Sonnet subagent — text-only changes, runs last.

### Task E1: README.md

1. **Security section (lines 140-147):** Update to match actual implementation:
   - Layer 3 (Content redaction): "Redaction is applied twice: in hooks before writing to the inbox, and in the ingest pipeline before database storage."
   - Layer 2 (File denylist): "Sensitive file patterns are never indexed — enforced in both the structural scanner and the conversation ingest pipeline."

2. **CaptureLevel documentation:** Add/update table showing actual behavior:
   | Level | tool_use | user prompts | ai responses | file diffs |
   |-------|----------|-------------|-------------|------------|
   | `metadata` (default) | stats only | NO | NO | stats only |
   | `redacted` | + command name | keywords only | NO | stats only |
   | `full` | + full output | full text (redacted) | full text (redacted) | full diff |

3. **Test count:** Update to final number after hotfix.

### Task E2: Design doc

1. **Line 225:** Verify claim "Hooks apply captureLevel gate BEFORE writing to disk" matches post-fix reality.
2. **CaptureLevel table (lines 219-223):** Verify matches implementation.

### Task E3: Implementation plan

1. Note `vitest.workspace.ts` → `vitest.config.ts` deviation (already noted, just verify).

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-02-25-carbon-copy-design.md`
- Modify: `docs/plans/2026-02-25-carbon-copy-implementation.md` (minor)

**Commit:** `docs: update README and design doc to match v3 hotfix implementation`

---

## Commit Summary

| # | Message | Task | Subagent |
|---|---------|------|----------|
| 1 | `fix: port project markers to hook resolveProjectRoot` | A1 | Opus |
| 2 | `fix: add hook-level secret redaction before inbox write` | A2 | Opus |
| 3 | `fix: add deterministic source_event_id to all hooks` | A3 | Opus |
| 4 | `fix: use Buffer byte slice for transcript tailer offset` | A4 | Opus |
| 5 | `fix: apply file denylist to conversation ingest pipeline` | B1 | Sonnet |
| 6 | `fix: correct LIKE escape in similarity dedup` | B2 | Sonnet |
| 7 | `fix: isolate store errors per file in ingest pipeline` | B3 | Sonnet |
| 8 | `fix: purge Carbon Copy tables and inbox files` | C1 | Sonnet |
| 9 | `feat: implement RAKE keyword extraction for redacted captureLevel` | D1 | Opus |
| 10 | `feat: enforce captureLevel redacted gates in hooks and pipeline` | D2+D3 | Opus |
| 11 | `docs: update README and design doc to match v3 hotfix implementation` | E1-E3 | Sonnet |

---

## Execution Order

```
Phase 1 (parallel):
  ├── A1 → A2 → A3 → A4  (Opus, sequential — shared files)
  ├── B1, B2, B3          (Sonnet subagent — independent fixes)
  └── C1                  (Sonnet subagent — isolated fix)

Phase 2 (after A completes):
  └── D1 → D2+D3          (Opus — depends on redact.js from A2)

Phase 3 (after all code fixes):
  └── E1+E2+E3             (Sonnet subagent — docs update)

Final: npm run check → all tests pass → ready for merge
```
