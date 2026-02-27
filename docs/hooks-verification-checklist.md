# Locus v3 Hooks — Live Verification Checklist

> Run in **fresh** Claude Code sessions. Each phase requires a separate session
> (hooks read `LOCUS_CAPTURE_LEVEL` at startup via `process.env`).

**DB path:** `~/.claude/memory/locus-490ac415806749a9/locus.db`
**Inbox path:** `~/.claude/memory/locus-490ac415806749a9/inbox/`

**Query helper** (paste into terminal to inspect DB):
```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const rows = db.prepare('SELECT id, event_id, kind, source, payload_json FROM conversation_events ORDER BY id DESC LIMIT 10').all();
for (const r of rows) console.log(r.id, r.kind, r.source, r.payload_json?.slice(0, 120));
db.close();
"
```

---

## Phase 1: `captureLevel=full` (all 3 hooks active)

**Setup:**
```bash
export LOCUS_CAPTURE_LEVEL=full
claude --plugin-dir /c/Users/Admin/gemini-project/ClaudeMagnificoMem
```

### Step 1 — Trigger UserPromptSubmit hook

Type any prompt, e.g.: `Что такое FTS5?`

**Verify:**
```bash
# Check inbox was consumed (should be empty — pipeline processes on startup/search)
ls ~/.claude/memory/locus-490ac415806749a9/inbox/

# Check conversation_events for user_prompt
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const rows = db.prepare(\"SELECT id, kind, payload_json FROM conversation_events WHERE kind = 'user_prompt' ORDER BY id DESC LIMIT 3\").all();
for (const r of rows) console.log(r.id, r.kind, r.payload_json?.slice(0, 200));
db.close();
"
```

- [ ] `kind = 'user_prompt'` row exists
- [ ] `payload_json` contains `"prompt":"Что такое FTS5?"` (full text, not keywords)
- [ ] No raw secrets in payload (if prompt contained any)

### Step 2 — Trigger Stop hook (AI response capture)

The Stop hook fires automatically after Claude responds.
Wait for Claude to finish answering, then verify:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const rows = db.prepare(\"SELECT id, kind, payload_json FROM conversation_events WHERE kind = 'ai_response' ORDER BY id DESC LIMIT 3\").all();
for (const r of rows) console.log(r.id, r.kind, r.payload_json?.slice(0, 200));
db.close();
"
```

- [ ] `kind = 'ai_response'` row exists
- [ ] `payload_json` contains `"response":"..."` with Claude's actual text
- [ ] Response is truncated/redacted (no secrets)

### Step 3 — Trigger PostToolUse hook

Ask Claude to read a file: `Прочитай README.md`

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const rows = db.prepare(\"SELECT id, kind, payload_json FROM conversation_events WHERE kind = 'tool_use' ORDER BY id DESC LIMIT 3\").all();
for (const r of rows) console.log(r.id, r.kind, r.payload_json?.slice(0, 200));
// Also check event_files join table
const files = db.prepare('SELECT * FROM event_files ORDER BY id DESC LIMIT 5').all();
for (const f of files) console.log('  file:', f.event_id?.slice(0, 8), f.file_path);
db.close();
"
```

- [ ] `kind = 'tool_use'` row exists
- [ ] `payload_json` contains `"tool":"Read"` and `"status":"success"`
- [ ] `event_files` has row with `file_path` = `README.md` path
- [ ] At `full` level: `bashCommand` present for Bash tool calls

### Step 4 — Verify search finds conversation events

```
memory_search query="FTS5"
```

- [ ] Returns result with `layer: "conversation"` containing the prompt
- [ ] FTS5 BM25 scoring works (relevance score > 0)

### Step 5 — Verify memory_timeline

```
memory_timeline timeRange={relative: "today"}
```

- [ ] Shows chronological events: user_prompt -> ai_response -> tool_use
- [ ] Events have correct timestamps and kinds

---

## Phase 2: `captureLevel=redacted` (RAKE keywords, no AI responses)

**Setup (new session):**
```bash
export LOCUS_CAPTURE_LEVEL=redacted
claude --plugin-dir /c/Users/Admin/gemini-project/ClaudeMagnificoMem
```

### Step 6 — UserPromptSubmit at redacted level

Type: `Fix the authentication bug in the login flow for production`

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const rows = db.prepare(\"SELECT payload_json FROM conversation_events WHERE kind = 'user_prompt' ORDER BY id DESC LIMIT 1\").all();
console.log(JSON.parse(rows[0].payload_json));
db.close();
"
```

- [ ] `payload.redacted === true` (marker flag)
- [ ] `payload.prompt` contains keywords like `authentication, bug, login flow, production`
- [ ] `payload.prompt` does NOT contain full sentence text
- [ ] Stopwords (`the`, `in`, `for`) are filtered out

### Step 7 — Stop hook blocked at redacted level

Wait for Claude to respond, then check:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const count = db.prepare(\"SELECT COUNT(*) as cnt FROM conversation_events WHERE kind = 'ai_response'\").get();
console.log('ai_response count:', count.cnt);
db.close();
"
```

- [ ] **No new** `ai_response` events created (count unchanged from Phase 1)
- [ ] Stop hook returns early without writing to inbox

### Step 8 — PostToolUse at redacted level

Ask Claude to run: `ls`

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const row = db.prepare(\"SELECT payload_json FROM conversation_events WHERE kind = 'tool_use' ORDER BY id DESC LIMIT 1\").get();
console.log(JSON.parse(row.payload_json));
db.close();
"
```

- [ ] `payload.tool` = `"Bash"`
- [ ] `payload.errorKind` present (or null if success)
- [ ] `payload.bashCommand` = `"ls"` (first token only, not full command)
- [ ] No full command output captured

---

## Phase 3: `captureLevel=metadata` (default — verify filtering)

**Setup (new session, no env var or explicit metadata):**
```bash
unset LOCUS_CAPTURE_LEVEL
claude --plugin-dir /c/Users/Admin/gemini-project/ClaudeMagnificoMem
```

### Step 9 — Prompts and responses filtered

Type any prompt and wait for response.

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
// Count events by kind from last 5 minutes
const since = Date.now() - 5 * 60 * 1000;
const rows = db.prepare('SELECT kind, COUNT(*) as cnt FROM conversation_events WHERE timestamp > ? GROUP BY kind').all(since);
for (const r of rows) console.log(r.kind, r.cnt);
db.close();
"
```

- [ ] `user_prompt` count = 0 (filtered by hook)
- [ ] `ai_response` count = 0 (filtered by hook)
- [ ] `tool_use` count > 0 (metadata always captured)
- [ ] tool_use payload has stats only (no `bashCommand`, no `errorKind`)

---

## Phase 4: Security verification

### Step 10 — Secret redaction in hooks

In a `full` session, type a prompt containing a fake secret:
`My API key is sk-test1234567890abcdefghij and the password is hunter2`

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const row = db.prepare(\"SELECT payload_json FROM conversation_events WHERE kind = 'user_prompt' ORDER BY id DESC LIMIT 1\").get();
const payload = JSON.parse(row.payload_json);
console.log('Prompt stored:', payload.prompt);
console.log('Contains sk-test?', payload.prompt.includes('sk-test1234567890'));
db.close();
"
```

- [ ] `sk-test1234567890abcdefghij` replaced with `sk-[REDACTED]`
- [ ] Raw secret NOT present in stored payload
- [ ] Redaction applied by hook BEFORE disk write (check inbox was empty)

### Step 11 — File denylist in pipeline

Create a test event with a `.env` file path:

```bash
INBOX="$HOME/.claude/memory/locus-490ac415806749a9/inbox"
mkdir -p "$INBOX"
cat > "$INBOX/test-denylist.json" << 'EOF'
{
  "version": 1,
  "event_id": "denylist-test-001",
  "source": "manual-test",
  "project_root": "C:/Users/Admin/gemini-project/ClaudeMagnificoMem",
  "timestamp": 1740000000000,
  "kind": "tool_use",
  "payload": { "tool": "Read", "files": [".env", "src/app.ts", "credentials.json"], "status": "success" }
}
EOF
```

Then trigger pipeline (call `memory_search` with any query), and verify:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.HOME + '/.claude/memory/locus-490ac415806749a9/locus.db');
const files = db.prepare(\"SELECT file_path FROM event_files WHERE event_id = 'denylist-test-001'\").all();
console.log('Stored file paths:', files.map(f => f.file_path));
// Cleanup
db.exec(\"DELETE FROM event_files WHERE event_id = 'denylist-test-001'\");
db.exec(\"DELETE FROM ingest_log WHERE event_id = 'denylist-test-001'\");
db.exec(\"DELETE FROM conversation_events WHERE event_id = 'denylist-test-001'\");
db.close();
"
```

- [ ] `src/app.ts` present in event_files
- [ ] `.env` NOT present (denylisted)
- [ ] `credentials.json` NOT present (denylisted)

---

## Summary

| # | What | Hook | Level | Pass? |
|---|------|------|-------|-------|
| 1 | Prompt captured | UserPromptSubmit | full | |
| 2 | AI response captured | Stop | full | |
| 3 | Tool use captured | PostToolUse | full | |
| 4 | Search finds events | pipeline + FTS5 | full | |
| 5 | Timeline shows events | memory_timeline | full | |
| 6 | RAKE keywords only | UserPromptSubmit | redacted | |
| 7 | AI response blocked | Stop | redacted | |
| 8 | Command name only | PostToolUse | redacted | |
| 9 | Prompts/responses filtered | all hooks | metadata | |
| 10 | Secrets redacted | UserPromptSubmit | full | |
| 11 | Denylist enforced | pipeline | any | |
