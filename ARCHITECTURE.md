# Locus — Architecture & Decisions

> **Locus** (лат. "место") — метод локусов Цицерона: запоминание через карту мест.
> Persistent memory plugin for Claude Code.
> "Knows your project, remembers your decisions, costs almost nothing."
>
> Working name: **Locus** (backup: Memoria)
> Repo: `github.com/???/locus`

---

## Problem Statement

All existing memory solutions (claude-mem, SimpleMem, mem0) remember **dialogs**, not **projects**.
No one builds a structural map of the codebase. Developers want an agent that:
- Knows the entire project structure without reading every file
- Remembers decisions ("why JWT, not sessions?")
- Recalls what happened in past sessions
- Does all of this without burning tokens

### Why Not Just a Good CLAUDE.md?

A skilled developer can write a CLAUDE.md with project architecture in 10 minutes. It will be 100% accurate.
So why build Locus?

| Aspect | CLAUDE.md | Locus |
|--------|-----------|-------|
| Accuracy at creation time | 100% (hand-written) | ~95% (regex-parsed) |
| Maintenance | Manual, decays silently | Auto-updates on file changes |
| Import/export graph | You won't write 200 import lines by hand | Built automatically, always current |
| Session history | None | Compressed episodic memory across sessions |
| Searchable | Only if agent reads entire file | FTS5 across all 3 layers |
| Scales to 500+ files | Impractical to maintain | Same cost: auto-scan |
| Cost | Free | Free (structural) / ~2 cents (semantic) |

**CLAUDE.md is great for static truths** ("we use Prisma", "deploy on Railway").
**Locus is for dynamic knowledge** that changes with the codebase.

They are complementary — Locus does NOT replace CLAUDE.md.
A project should have both: CLAUDE.md for invariants, Locus for living context.

---

## Competitive Landscape (Feb 2026)

| Project       | Stars | Approach                     | Weakness                              |
|---------------|-------|------------------------------|---------------------------------------|
| claude-mem    | 28.2k | Hooks + AI compression + Chroma | Broken on Windows (5+ open bugs), heavy deps |
| SimpleMem     | 2.9k  | 3-stage compression, beats claude-mem 64% | Python, needs OpenAI API key          |
| cognee        | 12k   | Graph + vector, 30+ sources | Platform, not a plugin                |
| mem0 MCP      | 578   | IDE preferences/patterns     | Tied to their cloud                   |
| MemoryMesh    | 330   | Graph memory                 | Narrow niche (RP/narrative)           |
| server-memory | 214   | Official MCP knowledge graph | Too primitive                         |

**Our niche**: Lightweight, cross-platform Claude Code plugin. Zero native deps. One command install. Knows the project structure for free (no LLM cost).

---

## Three-Layer Memory Architecture

### Layer 1: Structural Map (0 LLM tokens)

Local regex parsing of the project. Builds a map of files, exports, imports, dependencies.

```json
{
  "src/auth/login.ts": {
    "exports": ["loginUser", "validateToken", "AuthProvider"],
    "imports": ["prisma", "bcrypt", "jwt"],
    "reExports": ["AuthError from ./errors"],
    "type": "module",
    "lines": 142,
    "confidence": "high"
  },
  "src/auth/index.ts": {
    "exports": [],
    "imports": [],
    "reExports": ["* from ./login", "* from ./register"],
    "type": "barrel",
    "lines": 3,
    "confidence": "medium"
  }
}
```

**Key decisions:**
- Regex, NOT AST (see [Why Regex, Not AST?](#why-regex-not-ast) below)
- Strip comments/strings before parsing (block `/* */`, line `//`, template literals, strings)
- ~95% accuracy is acceptable; agent is instructed that map is approximate
- Each file gets a `confidence` field: `"high"` | `"medium"`
- Respect `.gitignore` + hardcoded ignore list
- Update incrementally via git diff with mtime fallback (see [Problem 6](#problem-6-incremental-update-reliability))

**Confidence heuristics (with reason):**
```
"high"                          -> normal module, exports parsed cleanly
"medium:barrel"                 -> barrel file (only re-exports, no own logic)
"medium:dynamic-import"         -> contains dynamic import() — runtime resolution unknown
"medium:alias-unresolved"       -> import path alias couldn't be resolved (tsconfig missing/broken)
"medium:multiline-export"       -> export declaration spans multiple lines, may be incomplete
"medium:generated"              -> file has auto-generated header comment
"medium:large-file"             -> file exceeds 500 LOC, regex may miss context-dependent patterns
```

The agent sees confidence + reason per-file and can decide when to read a file directly.
In MCP tool output, confidence reason is always shown:
```
login.ts:     exports [loginUser, LoginSchema]  confidence: high
index.ts:     re-exports [* from ./login]       confidence: medium:barrel
dynamic.ts:   exports [load]                    confidence: medium:dynamic-import
```

**Scan limits & skip rules:**
```
Max file size:        1 MB (files larger are skipped, logged as "skipped:too-large")
Max file count:       10,000 (projects larger trigger warning + only scan src-like dirs)
Binary detection:     first 8KB checked for null bytes -> skip (images, compiled, wasm)
Generated detection:  first 5 lines checked for patterns:
                        "// auto-generated", "/* generated by", "# DO NOT EDIT",
                        "// Code generated by", "@generated"
                      -> scanned but tagged confidence: "medium:generated"
Symlinks:             not followed (prevents infinite loops in monorepos)
```

**Hardcoded ignore list:**
```
node_modules, .git, .next, .nuxt, dist, build, .output, vendor,
__pycache__, .venv, venv, .env, *.min.js, *.map, *.lock, package-lock.json,
*.d.ts, coverage, .turbo, .vercel, .cache, tmp, temp
```

**Regex patterns (MVP — JS/TS + Python):**
```
JS/TS named exports:    ^export\s+(default\s+)?(class|function|const|let|var|type|interface|enum)\s+(\w+)
JS/TS re-exports:       ^export\s+\{([^}]+)\}\s+from\s+['"](.+)['"]
JS/TS barrel re-exports:^export\s+\*\s+(as\s+\w+\s+)?from\s+['"](.+)['"]
JS/TS imports:          ^import\s+.*\s+from\s+['"](.+)['"]
JS/TS dynamic imports:  (?:await\s+)?import\(['"](.+)['"]\)         -> confidence = "medium"
JS/TS type-only:        ^import\s+type\s+.*\s+from\s+['"](.+)['"]  -> tagged as type import
Python classes:         ^class\s+(\w+)
Python funcs:           ^def\s+(\w+)       (skip _prefix = private)
Python imports:         ^from\s+(\S+)\s+import|^import\s+(\S+)
Config files:           package.json -> stack, scripts, workspaces
                        requirements.txt / pyproject.toml -> dependencies
                        tsconfig.json -> path aliases (baseUrl + paths)
```

**Path alias resolution (tsconfig.json):**
```typescript
// If tsconfig.json has: { "paths": { "@/*": ["./src/*"] } }
// Then import from "@/auth/login" resolves to "src/auth/login"
// Stored in map as resolved path, original alias preserved as metadata
```

**Future (v2):** Go (`^func`, `^type ... struct`), Rust (`^pub fn`, `^pub struct`), Java (`^public class`).

### Layer 2: Semantic Memory (minimal tokens)

Decisions, context, architectural "why":
```
- "JWT not sessions — API is stateless"
- "Prisma not Drizzle — client requirement"
- "Tests via vitest, coverage > 80%"
- "Deploy on Railway, staging branch = auto-deploy"
```

Written once (on first project analysis or manually via `/remember`). Updated rarely. Cost: ~2 cents per project.

### Layer 3: Episodic Memory (lazy compression)

What happened in sessions:
```
Session 12 (2026-02-17): Fixed auth bug — token didn't refresh after 401.
  Files: src/auth/refresh.ts, src/middleware/auth.ts

Session 11 (2026-02-16): Added GET /orders/:id with pagination.
  Prisma cursor-based pagination.
```

**Compression modes (user-configurable):**
```
"manual"     -> only on /compact (0 extra tokens)
"threshold"  -> when buffer > 10k tokens (DEFAULT)
"aggressive" -> after every session
```

---

## Why Regex, Not AST?

This is the most frequently challenged decision. Here is the full reasoning.

### The AST Alternatives

| Option | Accuracy | Install size | Native deps | Cross-platform |
|--------|----------|-------------|-------------|----------------|
| **Regex (ours)** | ~95% | 0 | None | Yes |
| Tree-sitter | ~99.5% | +15-30 MB | node-gyp required | Fragile (Windows, musl) |
| SWC | ~99.9% | +50 MB | Rust binary | Needs per-platform build |
| TypeScript compiler | ~100% | +60 MB | None, but slow | Yes, but 10x scan time |

### Why 95% is Enough

The structural map is a **navigation aid**, not a type checker. The agent uses it to know
*which files exist and what they roughly contain*. When it needs exact details, it reads
the file directly. This is explicitly stated in every MCP tool description.

### What Regex Misses (and Mitigations)

| Pattern | Regex catches? | Mitigation |
|---------|---------------|------------|
| `export class Foo {}` | Yes | — |
| `export { foo } from './bar'` | Yes (re-export regex) | — |
| `export * from './bar'` | Yes (barrel regex) | Marked as `confidence: "medium"` |
| `export default function() {}` | Partial (no name) | Stored as `[default]` |
| `const x = 1; export { x }` | No (deferred export) | Missed, ~2% of real code |
| `module.exports = ...` (CJS) | No | CJS is legacy, deprioritized |
| Dynamic `import()` | Partial (literal strings only) | Runtime strings unknowable even by AST |
| Conditional exports | No | Rare, <1% of files |

**95% accuracy with honest `confidence` tagging > 99.5% accuracy with 30MB native dependency
that breaks on every other Windows machine.**

Tree-sitter is the right choice for an IDE. It's the wrong choice for a CLI plugin that
promises "one command install, zero deps, works everywhere."

---

## Critical Problems & Solutions

### Problem 1: sql.js Persistence

**Issue:** sql.js (WASM) is in-memory. Process crash = data loss.

**Solution:** Use `node:sqlite` (built-in since Node 22 LTS) as primary driver.
- Writes to disk natively
- Zero npm dependencies
- No node-gyp, no WASM

```typescript
let db: DatabaseAdapter;
try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new NodeSqliteAdapter(new DatabaseSync(dbPath));  // Node 22+
} catch {
  const initSqlJs = await import('sql.js');
  db = new SqlJsAdapter(dbPath);                         // Node 18-21
}
```

**Fallback (sql.js):** debounce save every 5s + graceful shutdown handlers (SIGINT, SIGTERM, beforeExit).
Inline WASM as Base64 (~1-2 MB, acceptable for CLI tool in 2026).

### Problem 2: WASM Binary Bundling

**Issue:** sql.js needs `sql-wasm.wasm` file, breaks "single file" concept.

**Solution:** Solved by `node:sqlite` for 85%+ of users. For fallback: inline Base64 WASM in JS bundle via esbuild loader.

### Problem 3: Regex False Positives

**Issue:** Regex finds exports inside comments, strings, template literals.

**Solution:** Single-pass character-level state machine with stack (NOT regex-replace).
See [Contract 4: stripNonCode State Machine](#contract-4-stripnoncode-state-machine) for
full specification, implementation, and test cases.

Key properties:
- O(n) single pass, handles nested template literals via stack
- Handles escaped quotes/backticks correctly
- Preserves line breaks (critical for line-based regex matching after strip)
- ~80 lines of production code, fully testable
- Kills ~97% of false positives (up from ~93% with naive regex-replace)

**Known limitation:** Does not detect regex literals (`/pattern/`). Impact <0.1% of real code.

### Problem 4: Context Window Explosion

**Issue:** Project with 1000 files -> 50-100k token map -> burns user's money.

**Solution:** Tiered delivery with hard limits:

```
MCP Resource memory://project-map (always attached, <2k tokens):
  Top-level folder tree + stack + DB model count.

  src/
    auth/     (4 files: login, register, refresh, middleware)
    api/      (3 files: orders, users, payments)
    utils/    (2 files: validate, helpers)
  Stack: TypeScript, Prisma, Zod, Express
  DB: PostgreSQL (14 models)
  Map confidence: 94% high, 6% medium

MCP Tool memory_explore(path) — agent requests details:
  > memory_explore("src/auth")
  login.ts:     exports [loginUser, LoginSchema]  confidence: high
                imports [prisma, bcrypt, zod, jwt]
  register.ts:  exports [registerUser, RegisterSchema]  confidence: high
                imports [prisma, bcrypt, zod, sendEmail]
  index.ts:     re-exports [* from ./login, * from ./register]  confidence: medium
                (barrel file — read directly for exact exports)

MCP Tool memory_search(query) — cross-layer search:
  > memory_search("email validation")
  [structural] src/utils/validate.ts -> validateEmail()
  [semantic]   "Validation via Zod schemas"
  [episodic]   "Session 11: added validatePhone, similar pattern"
```

Result: ~500 tokens auto-injected instead of 50-100k.

### Problem 5: FTS5 Availability in node:sqlite

**Issue:** Built-in `node:sqlite` may be compiled without FTS5 extension on some Node.js builds.

**Tested:** Node 25.2.1 on Windows 11 — FTS5 works fully (MATCH, rank, bm25).

**Solution:** Three-level fallback with runtime detection:

```
Priority 1: node:sqlite + FTS5     -> ideal (Node 22+, FTS5 present)
Priority 2: node:sqlite + LIKE     -> Node 22+, FTS5 missing (edge case)
Priority 3: sql.js + FTS5          -> Node 18-21 (sql.js bundles SQLite with FTS5)
```

FTS5 is always available: either via node:sqlite or via sql.js (which compiles
SQLite with FTS5 enabled). Priority 2 (LIKE fallback) is a safety net only.

Runtime detection:
```typescript
function detectFts5(db: DatabaseAdapter): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE _fts5_test USING fts5(c)');
    db.exec('DROP TABLE _fts5_test');
    return true;
  } catch {
    return false;
  }
}
```

### Problem 6: Incremental Update Reliability

**Issue:** Relying solely on `git diff` for incremental updates is fragile:
- Not all projects use git
- `git rebase`, `git checkout`, `git stash pop` change many files at once
- Code generators (prisma generate, graphql-codegen) produce files outside git flow
- Formatters (prettier --write) change file contents but not structure

**Solution:** Three-tier update strategy:

```
Tier 1: git diff (fast, precise)
  When: project is a git repo, no branch switch detected
  How:  git diff --name-only HEAD~1 -> rescan only changed files
  Cost: <100ms for typical commit

Tier 2: mtime comparison (reliable fallback)
  When: no git, or branch switch detected, or git diff fails
  How:  compare file mtime against lastScanTimestamp
  Cost: <500ms for 1000-file project (stat calls only)

Tier 3: full rescan (nuclear option)
  When: user runs /memory scan, or first run, or db corrupted
  How:  scan all files from scratch
  Cost: 1-3s for 1000-file project
```

**Implementation details:**
```typescript
interface ScanStrategy {
  type: 'git-diff' | 'mtime' | 'full';
  filesToScan: string[];
  reason: string;
}

function chooseScanStrategy(projectPath: string, lastScan: number): ScanStrategy {
  // 1. Try git
  if (isGitRepo(projectPath)) {
    const currentHead = getGitHead(projectPath);
    const lastHead = db.getLastScannedHead();

    if (currentHead === lastHead) {
      // Same branch, same commit — check git diff for unstaged changes
      const changed = gitDiffFiles(projectPath);
      if (changed.length > 0) {
        return { type: 'git-diff', filesToScan: changed, reason: 'unstaged changes' };
      }
      return { type: 'git-diff', filesToScan: [], reason: 'no changes' };
    }

    if (lastHead && isAncestor(lastHead, currentHead, projectPath)) {
      // Fast-forward — only scan files changed between commits
      const changed = gitDiffBetween(lastHead, currentHead, projectPath);
      return { type: 'git-diff', filesToScan: changed, reason: 'new commits' };
    }

    // Branch switch or rebase — fall through to mtime
  }

  // 2. mtime fallback
  const changedByMtime = findFilesByMtime(projectPath, lastScan);
  if (changedByMtime.length < totalFiles(projectPath) * 0.5) {
    return { type: 'mtime', filesToScan: changedByMtime, reason: 'mtime delta' };
  }

  // 3. Too many changes — full rescan is cheaper than per-file checks
  return { type: 'full', filesToScan: [], reason: 'bulk change detected' };
}
```

**Edge cases handled:**

| Scenario | Detection | Action |
|----------|-----------|--------|
| Normal commit | git diff | Rescan changed files only |
| `git checkout other-branch` | HEAD changed, not ancestor | mtime fallback |
| `git rebase` | HEAD changed, not ancestor | mtime fallback |
| `prettier --write .` | git diff shows changes | Rescan, but structure unchanged = no map changes |
| `prisma generate` | Output in .gitignore or ignore list | Skipped entirely |
| No git at all | isGitRepo = false | mtime always |
| First run ever | No lastScanTimestamp | Full scan |
| DB corrupted / missing | Open fails | Full scan + new DB |

### Problem 7: Secret Leakage & Data Trust

**Issue:** The `post-tool-use` hook captures tool results, which may contain:
- API keys, tokens, secrets from `.env` files the agent read
- Database connection strings with passwords
- Private URLs, internal hostnames
- Personal data visible in API responses

Without protection, users in corporate environments will never install this plugin.
One leaked token = reputation destroyed.

**Core principle: metadata-only by default, content is opt-in.**

Locus stores **what happened**, not **what was inside**. By default, no file content,
no tool output, no command results are ever written to the database. Only structural
signatures (symbol names, import paths) and event metadata (tool name, file path, status).

**Solution:** Defense in depth — four layers of protection:

```
Layer 0: Metadata-Only Default (never store raw content — THE KEY INSIGHT)
Layer 1: File-Level Denylist (never even process these files)
Layer 2: Content Redaction (safety net for opt-in text storage)
Layer 3: Storage Hygiene (local-only, no network, audit tools)
```

**Layer 0 — Metadata-Only Default (most important):**

What Locus stores by default vs what it never stores:

```
STORED (default):                         NEVER STORED (default):
  file path                                 file contents
  export names + kinds                      function bodies
  import paths                              variable values
  file type (module/barrel/config)          command output (stdout/stderr)
  confidence + reason                       tool result payloads
  lines count                               error messages with stack traces
  tool name + file path + success/failure   API responses
  session summary (LLM-compressed)          raw conversation text
  user /remember text (redacted)            .env values, tokens, keys
```

The `post-tool-use` hook extracts **exactly this** from each tool call:
```typescript
interface HookCapture {
  tool: string;           // "Read", "Write", "Bash", etc.
  filePath?: string;      // which file was touched
  status: 'success' | 'error';
  timestamp: number;
  // NO content field. Period.
}
```

**Opt-in for richer storage:**
Users who want Locus to capture more context (e.g., error messages for debugging history)
can explicitly opt in via config:
```json
// ~/.claude/memory/config.json
{
  "captureLevel": "metadata",        // DEFAULT: only metadata
  // "captureLevel": "redacted",     // OPT-IN: store redacted text (summaries, errors)
  // "captureLevel": "full"          // DANGER: store everything (never recommended)
}
```

Even at `"redacted"` level, all text passes through Layer 2 before storage.
Level `"full"` shows a warning on every startup and is flagged in `memory doctor`.

**Layer 1 — File Denylist (structural scanner + hooks):**
```typescript
const DENYLIST_FILES: string[] = [
  // Environment & secrets
  '.env', '.env.*',
  '.npmrc', '.pypirc', '.netrc', '.docker/config.json',
  // Cryptographic keys
  '*.pem', '*.key', '*.p12', '*.pfx', '*.jks',
  'id_rsa', 'id_ed25519', 'id_ecdsa',
  // Credential files
  'credentials.*', 'secrets.*', 'service-account*.json',
  '**/secrets/**', '**/.secrets/**',
  // Cloud configs with potential tokens
  '.aws/credentials', '.azure/accessTokens.json',
];
```

These files are **never scanned**, never enter the structural map, never trigger hooks.
If the agent reads one of these files, the hook sees the path, logs `"skipped:denylist"`, and discards.

**Layer 2 — Content Redaction (safety net for opt-in levels):**
```typescript
const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys with known prefixes
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})/g, replacement: 'sk-[REDACTED]' },
  { pattern: /\b(pk-[a-zA-Z0-9]{20,})/g, replacement: 'pk-[REDACTED]' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})/g, replacement: 'ghp_[REDACTED]' },
  { pattern: /\b(gho_[a-zA-Z0-9]{36,})/g, replacement: 'gho_[REDACTED]' },
  { pattern: /\b(glpat-[a-zA-Z0-9-_]{20,})/g, replacement: 'glpat-[REDACTED]' },
  { pattern: /\b(xox[bpas]-[a-zA-Z0-9-]+)/g, replacement: 'xox_-[REDACTED]' },

  // Generic KEY=VALUE patterns
  {
    pattern: /\b([A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*)\s*[=:]\s*['"]?(\S{8,})['"]?/gi,
    replacement: '$1=[REDACTED]'
  },

  // Connection strings
  { pattern: /((?:postgres|mysql|mongodb|redis|amqp):\/\/)[^\s'"]+/gi, replacement: '$1[REDACTED]' },

  // Bearer tokens
  { pattern: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi, replacement: '$1[REDACTED]' },

  // AWS keys
  { pattern: /\b(AKIA[0-9A-Z]{16})/g, replacement: 'AKIA[REDACTED]' },

  // Private key blocks
  {
    pattern: /-----BEGIN [\w\s]*PRIVATE KEY-----[\s\S]*?-----END [\w\s]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]'
  },
];

function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
```

**Layer 3 — Storage Hygiene & Trust UX:**

The DB file is local-only. No network calls, no cloud sync, no telemetry.
But we provide tools for the user to **see exactly what's stored** and **delete everything**:

```
/memory audit     -> show all stored data grouped by type, with counts and sizes
/memory purge     -> delete ALL memory for current project (with confirmation)
/memory export    -> dump memory to JSON for inspection (v1.0)
```

`memory audit` output example:
```
Locus Memory Audit — /home/user/my-app
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Capture level: metadata (default — no file content stored)

Structural map:   47 files, 142 exports, 89 imports
Semantic memory:   8 entries (320 tokens est.)
Episodic memory:  34 entries across 12 sessions (4,200 tokens est.)
Hook captures:   186 events (metadata only, no content)

DB size: 24 KB at ~/.claude/memory/a1b2c3d4.db
Log size: 12 KB at ~/.claude/memory/locus.log

No secrets detected in stored data.       (or: "WARNING: 2 potential secrets found — run /memory purge to clean")
Capture level is 'metadata' — no raw file content is stored.
```

**Net effect:** Even at `"metadata"` level, if a secret somehow passes all layers,
it lands in a local-only SQLite file that never leaves the machine. But the **default
behavior is to never store content at all**, which makes the attack surface near-zero.

Users can escalate to `"redacted"` for richer history, understanding the trade-off.
The `memory audit` command provides transparency. The `memory purge` command provides control.

---

## Context Injection Strategy

**CLAUDE.md — rejected for dynamic data.** Claude Code can overwrite or ignore runtime changes.
CLAUDE.md remains the right place for static project-level instructions.

**MCP Resources + Tools — correct path for live memory:**

| Type     | What                              | When                    |
|----------|-----------------------------------|-------------------------|
| Resource | `memory://project-map`            | Always attached (compact tree) |
| Resource | `memory://decisions`              | Always attached (semantic) |
| Resource | `memory://recent`                 | Always attached (last 3-5 episodes) |
| Tool     | `memory_explore(path)`            | Agent calls when needed |
| Tool     | `memory_search(query)`            | Agent calls when needed |
| Tool     | `memory_remember(text)`           | User/agent stores new info |
| Tool     | `memory_forget(query)`            | User removes old info |
| Tool     | `memory_scan()`                   | Rescan project structure |
| Tool     | `memory_status()`                 | Show memory stats & health |
| Tool     | `memory_doctor()`                 | Self-check: Node/FTS5/permissions/DB |
| Tool     | `memory_audit()`                  | Show all stored data summary |
| Tool     | `memory_purge()`                  | Delete all memory for current project |

**Auto-injected context budget:**
```
memory://project-map   -> <2,000 tokens (folder tree + stack summary)
memory://decisions     -> <500 tokens (5-15 decision bullets)
memory://recent        -> <1,000 tokens (last 3-5 session summaries)
-----------------------------------------------------------
Total auto-injected    -> <3,500 tokens per conversation
```

For reference: Claude's context window is 200k tokens. Our injection is <1.75%.

---

## Implementation Contracts

Precise specifications for every ambiguous boundary. These are **binding** — code must
match these contracts, tests must verify them.

### Contract 1: Hook Capture Fields (metadata-only)

What the `post-tool-use` hook extracts and stores at each capture level:

```
                          metadata    redacted    full
                          (DEFAULT)
toolName                  YES         YES         YES
filePaths[]               YES         YES         YES
status (success/error)    YES         YES         YES
timestamp                 YES         YES         YES
durationMs                YES         YES         YES
diffStats {+N, -N}        YES         YES         YES
exitCode                  YES         YES         YES
──────────────────────────────────────────────────────
errorKind (enum)          NO          YES         YES
bashCommandName           NO          YES*        YES
bashCommandArgs           NO          NO          YES
fileContent               NO          NO          YES
toolInput                 NO          NO          YES
stdout/stderr             NO          NO          YES
```

\* bashCommandName = first token only: "npm", "git", "prisma" — no arguments.

**Why exitCode is safe in metadata:** it's a number (0-255). Without argv or stdout,
it reveals nothing sensitive. `exit 1` means "something failed" — useful for diagnostic
patterns ("this tool fails 30% of the time") without leaking what it ran.

**Why errorKind enum instead of errorMessage:**
Raw error messages leak variable values, paths, stack traces. Instead, we classify
errors into a fixed enum and store only the category:

```typescript
type ErrorKind =
  | 'file_not_found'      // ENOENT
  | 'permission_denied'   // EACCES
  | 'timeout'             // command timed out
  | 'syntax_error'        // parse/compile error
  | 'network_error'       // ECONNREFUSED, DNS, etc.
  | 'exit_nonzero'        // command exited with non-zero (generic)
  | 'unknown';            // anything else

function classifyError(error: Error | string): ErrorKind {
  const msg = typeof error === 'string' ? error : error.message;
  if (/ENOENT|not found|no such file/i.test(msg)) return 'file_not_found';
  if (/EACCES|permission denied/i.test(msg)) return 'permission_denied';
  if (/timeout|timed out/i.test(msg)) return 'timeout';
  if (/syntax|parse|unexpected token/i.test(msg)) return 'syntax_error';
  if (/ECONNREFUSED|ENETUNREACH|DNS/i.test(msg)) return 'network_error';
  return 'unknown';
}
```

No text snippets stored in `redacted` mode. No "first 200 chars". The enum is
the summary — safe, structured, and useful for diagnostic patterns.

**TypeScript contract:**
```typescript
interface HookCaptureMetadata {
  toolName: string;            // "Read", "Write", "Bash", "Edit", "Glob", "Grep"
  filePaths: string[];         // affected file paths (empty for non-file tools)
  status: 'success' | 'error';
  exitCode?: number;           // 0-255 for Bash, undefined for other tools
  timestamp: number;           // Unix ms
  durationMs: number;
  diffStats?: { added: number; removed: number };  // only for Write/Edit
}

interface HookCaptureRedacted extends HookCaptureMetadata {
  errorKind?: ErrorKind;       // classified error category (no raw message)
  bashCommand?: string;        // command name only, no args: "npm", "git"
}

interface HookCaptureFull extends HookCaptureRedacted {
  bashFullCommand?: string;    // full command line with arguments
  toolInput?: unknown;         // raw tool input parameters
  toolOutput?: string;         // raw tool output (DANGER)
  fileContent?: string;        // raw file content (DANGER)
}

// Runtime type selected by captureLevel config
type HookCapture = HookCaptureMetadata | HookCaptureRedacted | HookCaptureFull;
```

### Contract 2: captureLevel Configuration

```typescript
type CaptureLevel = 'metadata' | 'redacted' | 'full';

// Config resolution (highest priority first):
// 1. ~/.claude/memory/{project-hash}.config.json   (per-project)
// 2. ~/.claude/memory/config.json                   (global)
// 3. 'metadata'                                     (hardcoded default)

interface LocusConfig {
  captureLevel: CaptureLevel;       // default: 'metadata'
  logLevel: 'error' | 'info' | 'debug';  // default: 'error'
  maskPaths: boolean;               // default: false
  compressionMode: 'manual' | 'threshold' | 'aggressive';  // default: 'threshold'
  compressionThreshold: number;     // default: 10000 (tokens)
  maxScanFiles: number;             // default: 10000
  maxFileSize: number;              // default: 1048576 (1MB)
  rescanThreshold: number;          // default: 0.3 (30% fraction)
  rescanAbsoluteMax: number;        // default: 200 (absolute file count)
  fullRescanCooldown: number;       // default: 300 (seconds)
  minScanInterval: number;          // default: 10 (seconds, debounce)
}

// CLI commands to change:
// /memory config captureLevel redacted     -> writes to per-project config
// /memory config captureLevel metadata     -> resets to default
// /memory config maskPaths true            -> enable path masking
```

**Startup behavior by level:**
```
metadata:  silent start
redacted:  [locus] Capture level: redacted (tool summaries stored after redaction)
full:      [locus] WARNING: Capture level is 'full' — raw content is being stored!
           [locus] Run '/memory config captureLevel metadata' to change.
           (also flagged in memory_doctor as [WARN])
```

### Contract 3: Content-Free Logger

**Principle:** Logs are safe to share in a bug report without review.

```
ALWAYS logged (all levels):
  File paths (relative to project root)     src/auth/login.ts
  Tool names                                Read, Write, Bash
  Scan strategy decisions                   "mtime: 12 files changed"
  Timing information                        "parsed in 82ms"
  Counts                                    "3 exports, 4 imports"
  Confidence values                         "confidence: medium:barrel"
  DB operations (type only)                 "INSERT INTO memories"
  Error types (without details)             "FTS5 detection failed"

NEVER logged (any level):
  File contents
  Environment variable values
  Command arguments (beyond command name)
  Tool output / stdout / stderr
  Error messages with variable values       "key 'ABC123' not found" -> NO
  User /remember text
  Search queries (may contain sensitive context)

CONDITIONALLY logged (only with maskPaths=true):
  Paths masked beyond last 2 components:    /****/****/src/auth/login.ts
  Home directory replaced:                  ~/****/project/src/...
```

**maskPaths implementation:**
```typescript
function maskPath(fullPath: string, maskEnabled: boolean): string {
  if (!maskEnabled) return fullPath;
  const parts = fullPath.split('/');
  if (parts.length <= 3) return fullPath;  // already short enough
  const kept = parts.slice(-3);            // last 3 components
  return '****/' + kept.join('/');
}
// /home/user/secret-client/internal-api/src/auth/login.ts
// -> ****/src/auth/login.ts
```

### Contract 4: stripNonCode State Machine

**NOT regex-replace. Single-pass character-level state machine with stack + brace depth.**

The purpose of stripNonCode is to remove comments and string/template **literal content**
so that our export/import regex only matches real code. Code inside `${}` template
expressions IS real code and MUST be emitted — it can contain `import()` calls.

```typescript
type State = 'CODE' | 'LINE_COMMENT' | 'BLOCK_COMMENT'
           | 'SQ_STRING' | 'DQ_STRING' | 'TEMPLATE';

interface StripContext {
  state: State;
  stack: Array<{ state: State; braceDepth: number }>;  // for nested templates
  braceDepth: number;  // tracks {} nesting within current template expression
  output: string[];
  i: number;
}

function stripNonCode(source: string): string {
  const ctx: StripContext = {
    state: 'CODE', stack: [], braceDepth: 0, output: [], i: 0
  };

  while (ctx.i < source.length) {
    const ch = source[ctx.i];
    const next = source[ctx.i + 1];

    switch (ctx.state) {
      case 'CODE':
        if (ch === '/' && next === '/') {
          ctx.state = 'LINE_COMMENT'; ctx.i += 2;
        } else if (ch === '/' && next === '*') {
          ctx.state = 'BLOCK_COMMENT'; ctx.i += 2;
        } else if (ch === "'") {
          ctx.state = 'SQ_STRING'; ctx.i++;
        } else if (ch === '"') {
          ctx.state = 'DQ_STRING'; ctx.i++;
        } else if (ch === '`') {
          ctx.state = 'TEMPLATE'; ctx.i++;
        } else if (ch === '{') {
          ctx.braceDepth++;
          ctx.output.push(ch); ctx.i++;
        } else if (ch === '}' && ctx.stack.length > 0 && ctx.braceDepth === 0) {
          // Closing a ${...} expression — return to TEMPLATE state
          const frame = ctx.stack.pop()!;
          ctx.state = frame.state;         // back to TEMPLATE
          ctx.braceDepth = frame.braceDepth;
          ctx.i++;                         // consume the '}'
        } else if (ch === '}') {
          ctx.braceDepth = Math.max(0, ctx.braceDepth - 1);
          ctx.output.push(ch); ctx.i++;
        } else {
          ctx.output.push(ch); ctx.i++;
        }
        break;

      case 'LINE_COMMENT':
        if (ch === '\n') {
          ctx.state = 'CODE'; ctx.output.push('\n'); ctx.i++;
        } else { ctx.i++; }
        break;

      case 'BLOCK_COMMENT':
        if (ch === '*' && next === '/') {
          ctx.state = 'CODE'; ctx.i += 2;
        } else { ctx.i++; }
        break;

      case 'SQ_STRING':
        if (ch === '\\') { ctx.i += 2; }
        else if (ch === "'") {
          ctx.state = 'CODE';
          ctx.output.push('""'); ctx.i++;
        } else { ctx.i++; }
        break;

      case 'DQ_STRING':
        if (ch === '\\') { ctx.i += 2; }
        else if (ch === '"') {
          ctx.state = 'CODE';
          ctx.output.push('""'); ctx.i++;
        } else { ctx.i++; }
        break;

      case 'TEMPLATE':
        if (ch === '\\') { ctx.i += 2; }
        else if (ch === '$' && next === '{') {
          // Enter template expression — save current context, switch to CODE
          ctx.stack.push({ state: 'TEMPLATE', braceDepth: ctx.braceDepth });
          ctx.braceDepth = 0;             // fresh brace depth for this expression
          ctx.state = 'CODE';
          ctx.i += 2;
        } else if (ch === '`') {
          // End of template literal
          ctx.state = 'CODE';
          ctx.output.push('``'); ctx.i++;
        } else { ctx.i++; }              // eat template content
        break;
    }
  }

  return ctx.output.join('');
}
```

**Brace depth tracking explained:**

The tricky part is knowing when `}` closes a template expression vs a regular block:
```javascript
`prefix ${items.map(x => { return x.name; })} suffix`
//                        ^                 ^  ^
//                        braceDepth=1      |  |
//                              braceDepth=0   |
//                              closes ${}     closes template
```

Each `${` saves current braceDepth to stack, resets to 0. Each `{` in CODE increments.
Each `}` in CODE: if braceDepth > 0, decrements. If braceDepth === 0 AND stack has frames,
pops back to TEMPLATE state.

**Why regex literals are NOT handled (explicit decision):**

Regex literal detection (`/pattern/flags`) requires knowing the preceding token:
```javascript
const x = a / b;        // division
const x = /pattern/g;   // regex literal
if (/test/.test(s)) {}  // regex literal
return /abc/i;           // regex literal
```

Correct disambiguation requires a tokenizer that tracks whether `/` follows an
expression (division) or a statement/operator (regex). This is ~200 lines of code
for <0.1% impact on our use case:

- Regex literals rarely contain `export` or `import` keywords
- If they do (e.g. `/import\s+/`), the regex match would fail on surrounding context
  because our import regex requires `from '...'` at end of line
- Only pathological case: `const re = /export function foo() {}/` on a line by itself
  — essentially never happens in real code

**Decision:** skip regex literal handling in v1. Add in v2 if any false positive
is reported. Track in test suite as known limitation.

**Key properties:**
- Single pass, O(n) time, O(depth) space (depth = nested template level, usually 0-2)
- Handles `'escaped\'quote'` correctly
- Handles `` `${`nested`}` `` correctly via stack + brace depth
- Code inside `${}` IS emitted (it's real code, may contain imports)
- Template literal content (outside `${}`) is NOT emitted (it's string data)
- Preserves line breaks (important for line-based regex matching after strip)
- Replaces strings/templates with `""` / ` `` ` placeholders (preserves line structure)
- Regex literals not handled (explicit, justified, tracked)
- ~100 lines of production code

**Test cases for state machine:**
```typescript
// Basic stripping
'const s = "hello";'                -> 'const s = "";'
"const s = 'hello';"               -> 'const s = "";'
'// comment\nexport const x = 1'    -> '\nexport const x = 1'
'/* block */ export const y = 1'    -> ' export const y = 1'

// Escaped quotes
"const s = 'it\\'s fine';"         -> 'const s = "";'
'const s = "say \\"hello\\"";'    -> 'const s = "";'

// Template literals — content stripped, code preserved
'const x = `hello`;'               -> 'const x = ``;'
'const x = `${a + b}`;'            -> 'const x = `a + b`;'    // CODE inside ${} emitted
'const x = `${fn("arg")}`;'        -> 'const x = `fn("")`;'   // string inside ${} stripped

// Nested templates
'`a${`b${c}`}d`'                    -> '``b${c}``'   // inner template also stripped
'`${obj["key"]}`'                   -> '`obj[""]`'    // DQ_STRING inside expr stripped

// Brace depth
'`${items.map(x => { return x; })}` '  -> '`items.map(x => { return x; })`'
'`${{ a: 1 }}`'                     -> '`{ a: 1 }`'   // object literal, braceDepth tracks

// Dynamic import inside template expression (must be preserved!)
'`${import("./module")}`'           -> '`import("")`'  // import preserved, arg stripped
'`${await import("./x")}`'          -> '`await import("")`'

// Mixed
'export const x = `hello`; // comment'  -> 'export const x = ``;\n'
'const re = /test/g;'               -> 'const re = /test/g;'  // regex NOT handled, passes through
```

### Contract 5: Dynamic Import Classification

```typescript
// Regex for dynamic imports (applied AFTER stripNonCode)
const DYNAMIC_IMPORT_REGEX = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Result classification:
// Literal string argument -> treat as normal import, confidence: high
// Non-literal (variable, template) -> already stripped by stripNonCode, won't match regex
// So: if regex matches, it's always a literal -> always high confidence

interface ImportEntry {
  source: string;
  resolvedPath?: string;
  isTypeOnly: boolean;
  isDynamic: boolean;        // true for import() syntax
  // confidence comes from FileEntry level, not per-import
}
```

**The key insight:** after `stripNonCode`, dynamic imports with template literals
(`` import(`./plugins/${name}`) ``) become `import(``)` — the regex won't match.
Only literal string imports survive: `import('./utils')` stays as-is.

So we don't need a separate confidence reason for dynamic imports with literal paths.
They're just regular imports with `isDynamic: true` and confidence stays `high`.

`medium:dynamic-import` at file level is set when we detect the `import(` pattern
in the **original** source (before strip) but the regex doesn't find a literal match —
meaning there's a non-literal dynamic import we can't resolve.

### Contract 6: Incremental Update Thresholds

```typescript
const INCREMENTAL_CONFIG = {
  // Fraction threshold: if more than this % of files changed, do full rescan
  rescanThreshold: 0.3,       // 30% — configurable via config.json

  // Absolute threshold: if more than this many files changed, full rescan
  // regardless of fraction (prevents slow per-file rescans on large repos)
  rescanAbsoluteMax: 200,     // 200 files — configurable

  // If mtime scan finds this many files, warn in log
  mtimeWarnThreshold: 100,    // "100 files changed since last scan"

  // If git diff returns error, don't panic — try mtime
  gitDiffTimeout: 5000,       // 5s timeout for git commands

  // Debounce: don't rescan if last scan was less than N seconds ago
  minScanInterval: 10,        // 10 seconds

  // Cooldown after full rescan: don't do another full rescan for this long
  // (prevents repeated full rescans during active rebase/checkout sequences)
  fullRescanCooldown: 300,    // 5 minutes
};

// Decision tree (pseudocode):
function chooseScanStrategy(projectPath, lastScan, lastHead): ScanStrategy {
  if (timeSinceLastScan < minScanInterval) return { type: 'skip', reason: 'debounce' };

  // Cooldown: don't full-rescan again too soon
  const canFullRescan = timeSinceLastFullRescan > fullRescanCooldown;

  if (isGitRepo) {
    currentHead = getHead();
    if (currentHead === lastHead) {
      changed = gitDiffUnstaged();  // only unstaged changes
      return { type: 'git-diff', files: changed };
    }
    if (isAncestor(lastHead, currentHead)) {
      changed = gitDiffBetween(lastHead, currentHead);
      if (shouldFullRescan(changed.length, totalFiles, canFullRescan)) {
        return { type: 'full', reason: `git: ${changed.length} files changed` };
      }
      return { type: 'git-diff', files: changed };
    }
    // HEAD changed but not ancestor (rebase, checkout) -> fall to mtime
  }

  // mtime path
  changed = findByMtime(projectPath, lastScan);
  if (shouldFullRescan(changed.length, totalFiles, canFullRescan)) {
    return { type: 'full', reason: `mtime: ${changed.length} files changed` };
  }
  return { type: 'mtime', files: changed };
}

function shouldFullRescan(changed: number, total: number, canRescan: boolean): boolean {
  if (!canRescan) return false;  // cooldown active, do incremental even if many files
  if (changed > rescanAbsoluteMax) return true;        // >200 files = always rescan
  if (changed / total > rescanThreshold) return true;  // >30% = rescan
  return false;
}
```

### Contract 7: Project Root Resolution

```typescript
const PROJECT_MARKERS = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  '*.sln',
  'composer.json',
  'Gemfile',
  'deno.json',
  'bun.lockb',
] as const;

function resolveProjectRoot(cwd: string): { root: string; method: ProjectRootMethod } {
  // 1. Git root — always wins
  const gitRoot = tryGitRoot(cwd);
  if (gitRoot) return { root: gitRoot, method: 'git-root' };

  // 2. Walk up, find nearest marker to filesystem root
  //    (= the HIGHEST marker in the tree, not the closest to cwd)
  let highestMarkerDir: string | null = null;
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    if (hasAnyMarker(dir, PROJECT_MARKERS)) {
      highestMarkerDir = dir;  // keep walking up, overwrite with higher match
    }
    dir = path.dirname(dir);
  }
  if (highestMarkerDir) return { root: highestMarkerDir, method: 'project-marker' };

  // 3. cwd fallback
  return { root: cwd, method: 'cwd-fallback' };
}

type ProjectRootMethod = 'git-root' | 'project-marker' | 'cwd-fallback';
```

**Why highest marker, not nearest?**
```
~/monorepo/                      <- package.json (root workspace)
~/monorepo/packages/web/         <- package.json (workspace member)
~/monorepo/packages/web/src/     <- cwd

Nearest marker: ~/monorepo/packages/web/   WRONG (only sees one package)
Highest marker: ~/monorepo/                CORRECT (sees entire monorepo)
```

**Edge case: unrelated markers up the tree**
```
~/                               <- no markers
~/projects/                      <- no markers
~/projects/my-app/               <- package.json    <- THIS is root
~/projects/my-app/src/           <- cwd
```
This works correctly — `~/projects/` has no marker, so `~/projects/my-app/` is highest.

**What if ~/ has a package.json?**
Some users have `~/package.json` (global tools). This would incorrectly claim `~/` as root.
Mitigation: skip if marker file is in home directory root AND has no meaningful content
(empty deps, no scripts). But this is a v2 refinement — for MVP, document the edge case.

**v1 scope: repo-level identity only.**
In v1, one repo = one DB = one memory space. This means in a monorepo,
`packages/web` and `packages/api` share the same structural map and episodic memory.
This is **intentional**: the agent should see the whole repo to understand cross-package
dependencies.

Package-level isolation (separate memory per workspace member) is a v2 feature
and requires workspace-aware scanning (reading `workspaces` from package.json /
pnpm-workspace.yaml). Users expecting per-package memory in v1 will see it in
`memory_status()` output:
```
Project root: ~/monorepo (git-root)
Scope: repo-level (all packages share memory)
Packages detected: web, api, shared (3 workspaces)
Per-package isolation: not available (planned v2)
```

### Contract 8: MCP Resource Formats & Token Budgets

**memory://project-map (hard limit: 2,000 tokens)**

```
Project: {name} ({stack items, comma-separated})
Files: {scanned} scanned, {skipped} skipped | Confidence: {high}% high, {medium}% medium
Last scan: {relative time} ({strategy}, {duration}ms)

{directory tree, 2 levels deep}
```

Tree formatting rules:
```
1. Max 2 levels of nesting from project root
   src/
     auth/       4 files: login, register, refresh, middleware
   NOT:
   src/
     auth/
       helpers/  <- too deep, collapsed into parent

2. If directory has <=8 files: list file names (without extensions)
   auth/       4 files: login, register, refresh, middleware

3. If directory has >8 files: count only
   components/ 24 files

4. If total directories >20: show top 15 by file count, then "+ 8 more dirs"

5. Test directories collapsed to single line
   tests/      42 files (unit: 30, integration: 12)

6. Config files at root NOT listed individually (package.json, tsconfig, etc.)
   They're covered by the "Stack:" line
```

**memory://decisions (hard limit: 500 tokens)**

```
{bullet list, one decision per line, max 15}
```

Rules:
```
1. Each entry: "- {decision} ({reason})" — one line, max 100 chars
2. Max 15 entries shown
3. If >15: show 15 most recent, append "  (+{N} older — use memory_search)"
4. Sorted by: most recently updated first
5. No headers, no formatting — just a bullet list
```

**memory://recent (hard limit: 1,000 tokens)**

```
Session {N} ({relative time}): {one-line summary}
  Files: {comma-separated list of changed files}
```

Rules:
```
1. Show last 3-5 sessions (fit within 1000 tokens)
2. Each session: summary line (max 120 chars) + files line
3. Files: max 5 listed, then "+ {N} more"
4. If no sessions yet: "No sessions recorded. Start working and Locus will track."
5. Sorted: most recent first
```

**Token counting method:**
```typescript
// Simple estimation: 1 token ~= 4 chars (for English/code mixed content)
// Validated against cl100k_base tokenizer: within 15% accuracy
// Good enough for budget enforcement — we're targeting <2000, not exactly 2000
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Hard enforcement in resource generation:
function generateProjectMap(files: FileEntry[]): string {
  let result = buildProjectMapString(files);
  while (estimateTokens(result) > 2000) {
    // Progressively reduce detail:
    // 1. Collapse directories with >5 files to counts
    // 2. Reduce tree depth to 1 level
    // 3. Remove file names entirely, show only directory counts
    // 4. Truncate + append "(truncated — use memory_explore for details)"
    result = reduceDetail(result);
  }
  return result;
}
```

### Contract 9: memory_purge Confirmation (Two-Call Pattern)

MCP tools cannot prompt the user for confirmation — they are request/response only.
Destructive operations need a safe confirmation pattern.

**Solution: two-call token-based confirmation.**

```typescript
// First call: no token -> returns confirmation prompt with token
// Second call: with token -> executes deletion

interface PurgeRequest {
  confirmToken?: string;  // absent on first call
}

interface PurgeResponsePending {
  status: 'pending_confirmation';
  confirmToken: string;         // random token, valid for 60 seconds
  message: string;              // human-readable warning
  stats: {
    files: number;
    memories: number;
    episodes: number;
    dbSizeBytes: number;
  };
}

interface PurgeResponseDone {
  status: 'purged';
  message: string;
  deletedDbPath: string;
}

interface PurgeResponseError {
  status: 'error';
  message: string;  // "invalid token", "token expired", etc.
}

type PurgeResponse = PurgeResponsePending | PurgeResponseDone | PurgeResponseError;
```

**Flow:**
```
Agent: memory_purge()
Locus: {
  status: "pending_confirmation",
  confirmToken: "purge-a7f3b2c1",
  message: "This will delete ALL memory for /home/user/my-app. 47 files, 8 decisions, 34 episodes. This cannot be undone.",
  stats: { files: 47, memories: 8, episodes: 34, dbSizeBytes: 24576 }
}

Agent shows message to user. User confirms.

Agent: memory_purge({ confirmToken: "purge-a7f3b2c1" })
Locus: {
  status: "purged",
  message: "Deleted ~/.claude/memory/a1b2c3d4.db (24 KB). Memory cleared.",
  deletedDbPath: "~/.claude/memory/a1b2c3d4.db"
}
```

**Security:**
- Token is `purge-` + 8 random hex chars, generated per-call
- Token expires after 60 seconds (prevents stale confirmations)
- Token is single-use (deleted after successful purge)
- Only one active token per project at a time

This pattern is also used by `memory_forget` when the query matches >5 entries
(to prevent accidental mass deletion).

---

## Type System & Core Interfaces

Strict TypeScript. No `any`. All public API surfaces typed.

```typescript
// --- Storage Layer ---

interface DatabaseAdapter {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): RunResult;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  close(): void;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// --- Structural Map ---

type ConfidenceLevel = 'high' | 'medium';
type ConfidenceReason =
  | 'barrel'
  | 'dynamic-import'
  | 'alias-unresolved'
  | 'multiline-export'
  | 'generated'
  | 'large-file';

interface Confidence {
  level: ConfidenceLevel;
  reason?: ConfidenceReason;  // absent when level = "high"
}

interface FileEntry {
  relativePath: string;
  exports: ExportEntry[];
  imports: ImportEntry[];
  reExports: ReExportEntry[];
  fileType: 'module' | 'barrel' | 'config' | 'script' | 'test';
  language: 'typescript' | 'javascript' | 'python';
  lines: number;
  confidence: Confidence;
  lastScanned: number;    // Unix timestamp ms
  skippedReason?: string; // "too-large" | "binary" — only for skipped files in stats
}

interface ExportEntry {
  name: string;           // e.g. "loginUser", "[default]"
  kind: 'function' | 'class' | 'const' | 'let' | 'var' | 'type' | 'interface' | 'enum' | 'unknown';
  isDefault: boolean;
  isTypeOnly: boolean;
}

interface ImportEntry {
  source: string;         // e.g. "prisma", "./utils", "@/auth/login"
  resolvedPath?: string;  // e.g. "src/auth/login" (after alias resolution)
  isTypeOnly: boolean;
  isDynamic: boolean;
}

interface ReExportEntry {
  source: string;         // e.g. "./login"
  names: string[] | '*';  // specific names or wildcard
}

// --- Semantic Memory ---

interface MemoryEntry {
  id: number;
  layer: 'semantic' | 'episodic';
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
}

// --- Search ---

interface SearchResult {
  layer: 'structural' | 'semantic' | 'episodic';
  content: string;
  relevance: number;      // 0.0-1.0
  source: string;         // file path or memory entry id
}

// --- Scanner ---

interface ScanResult {
  files: FileEntry[];
  stats: ScanStats;
  strategy: ScanStrategy;
}

interface ScanStats {
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  highConfidence: number;
  mediumConfidence: number;
  durationMs: number;
}

interface ScanStrategy {
  type: 'git-diff' | 'mtime' | 'full';
  filesToScan: string[];
  reason: string;
}

// --- MCP Server ---

interface LocusMcpServer {
  // Resources (auto-attached)
  getProjectMap(): string;
  getDecisions(): string;
  getRecentEpisodes(): string;

  // Tools (on-demand)
  explore(path: string): string;
  search(query: string): SearchResult[];
  remember(text: string, tags?: string[]): void;
  forget(query: string): number;  // returns deleted count
  scan(): ScanResult;
  status(): MemoryStatus;
}

// --- Configuration ---

type CaptureLevel = 'metadata' | 'redacted' | 'full';

interface LocusConfig {
  captureLevel: CaptureLevel;
  logLevel: 'error' | 'info' | 'debug';
  maskPaths: boolean;
  compressionMode: 'manual' | 'threshold' | 'aggressive';
  compressionThreshold: number;       // tokens
  maxScanFiles: number;
  maxFileSize: number;                // bytes
  rescanThreshold: number;            // 0.0-1.0 fraction
}

const LOCUS_DEFAULTS: LocusConfig = {
  captureLevel: 'metadata',
  logLevel: 'error',
  maskPaths: false,
  compressionMode: 'threshold',
  compressionThreshold: 10000,
  maxScanFiles: 10000,
  maxFileSize: 1048576,               // 1MB
  rescanThreshold: 0.3,               // 30%
  rescanAbsoluteMax: 200,
  fullRescanCooldown: 300,            // 5 minutes
  minScanInterval: 10,                // 10 seconds
};

// --- Status ---

interface MemoryStatus {
  projectPath: string;
  projectRoot: string;       // resolved via git root / marker / cwd
  projectRootMethod: 'git-root' | 'project-marker' | 'cwd-fallback';
  dbPath: string;
  dbSizeBytes: number;
  captureLevel: 'metadata' | 'redacted' | 'full';
  totalFiles: number;
  skippedFiles: number;
  totalMemories: number;
  totalEpisodes: number;
  lastScan: number;
  scanStrategy: string;
  nodeVersion: string;
  storageBackend: 'node:sqlite' | 'sql.js';
  fts5Available: boolean;
}

// --- Doctor ---

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;              // suggested fix command/action
}

interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failures: number;
}

// --- Error Classification (Contract 1) ---

type ErrorKind =
  | 'file_not_found'
  | 'permission_denied'
  | 'timeout'
  | 'syntax_error'
  | 'network_error'
  | 'exit_nonzero'
  | 'unknown';

// --- Purge Confirmation (Contract 9) ---

interface PurgeResponsePending {
  status: 'pending_confirmation';
  confirmToken: string;
  message: string;
  stats: { files: number; memories: number; episodes: number; dbSizeBytes: number };
}

interface PurgeResponseDone {
  status: 'purged';
  message: string;
  deletedDbPath: string;
}

type PurgeResponse = PurgeResponsePending | PurgeResponseDone | { status: 'error'; message: string };
```

---

## Testing Strategy

Regex parsing without tests is a ticking bomb. Testing is a **hard MVP requirement**.

### Test Categories

```
tests/
  scanner/
    exports.test.ts          <- 60+ cases for export parsing
    imports.test.ts          <- 40+ cases for import parsing
    re-exports.test.ts       <- 20+ cases for re-export patterns
    strip-non-code.test.ts   <- 30+ cases for comment/string stripping
    python.test.ts           <- 30+ cases for Python parsing
    confidence.test.ts       <- 15+ cases for confidence heuristics
    path-aliases.test.ts     <- 10+ cases for tsconfig path resolution
  storage/
    adapter.test.ts          <- node:sqlite and sql.js parity tests
    fts5.test.ts             <- full-text search with fallback
    migrations.test.ts       <- schema upgrade paths
  redaction/
    patterns.test.ts         <- 40+ cases for secret detection
    file-ignore.test.ts      <- file-level ignore rules
    false-positives.test.ts  <- ensure normal code isn't over-redacted
  incremental/
    git-diff.test.ts         <- git-based incremental scan
    mtime.test.ts            <- mtime-based fallback
    strategy.test.ts         <- scan strategy selection logic
  integration/
    mcp-server.test.ts       <- MCP protocol compliance
    real-projects.test.ts    <- scan real open-source repos (fixtures)
    e2e.test.ts              <- full lifecycle: scan -> store -> search -> retrieve
  fixtures/
    barrel-file/             <- index.ts with re-exports
    dynamic-imports/         <- await import() patterns
    path-aliases/            <- tsconfig with paths
    comments-in-exports/     <- exports inside comments/strings
    python-project/          <- typical Python package
    mixed-project/           <- JS + Python in one repo
    edge-cases/              <- deferred exports, CJS, etc.
```

### Export Parsing Test Cases (representative sample)

```typescript
// -- Standard exports --
'export function foo() {}'                          // -> { name: 'foo', kind: 'function' }
'export default class App {}'                       // -> { name: 'App', kind: 'class', isDefault: true }
'export const BAR = 1'                              // -> { name: 'BAR', kind: 'const' }
'export let counter = 0'                            // -> { name: 'counter', kind: 'let' }
'export type User = { id: string }'                 // -> { name: 'User', kind: 'type' }
'export interface Config {}'                        // -> { name: 'Config', kind: 'interface' }
'export enum Status { Active, Inactive }'           // -> { name: 'Status', kind: 'enum' }

// -- Re-exports --
"export { foo, bar } from './utils'"                // -> reExport { source: './utils', names: ['foo','bar'] }
"export { default as Main } from './main'"          // -> reExport { source: './main', names: ['Main'] }
"export * from './types'"                           // -> reExport { source: './types', names: '*' }
"export * as utils from './utils'"                  // -> reExport { source: './utils', names: '*' }

// -- Type-only --
"export type { User } from './models'"              // -> typeOnly: true
"import type { Config } from './config'"            // -> typeOnly: true

// -- Should NOT match (inside comments/strings) --
'// export function old() {}'                       // -> no match
'/* export class Disabled {} */'                    // -> no match
"const s = 'export const fake = 1'"                 // -> no match
'`template with export const x = 1`'               // -> no match

// -- Edge cases --
'export default function() {}'                      // -> { name: '[default]', kind: 'function' }
'export default 42'                                 // -> { name: '[default]', kind: 'unknown' }
```

### Redaction Test Cases (representative sample)

```typescript
// -- Must redact --
'API_KEY=sk-abc123def456ghi789'                     // -> 'API_KEY=[REDACTED]'
'Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy'              // -> 'Bearer [REDACTED]'
'postgres://user:p@ssw0rd@host:5432/db'             // -> 'postgres://[REDACTED]'
'ghp_1234567890abcdefghijklmnopqrstuvwxyz'          // -> 'ghp_[REDACTED]'
'AKIAIOSFODNN7EXAMPLE'                              // -> 'AKIA[REDACTED]'

// -- Must NOT redact (false positive protection) --
'export function validateToken(token: string) {}'   // -> unchanged
'const MAX_TOKEN_LENGTH = 256'                      // -> unchanged
'import { SECRET_MANAGER } from "./config"'         // -> unchanged
'// This is a comment about password hashing'       // -> unchanged
'const base64 = btoa("hello world")'                // -> unchanged (too short)
```

### Test Runner

```
Framework:  vitest (fast, native TypeScript, no config needed)
Coverage:   >90% on scanner, storage, redaction modules
CI:         GitHub Actions matrix: Node 20, 22, 24 x Windows, Linux, macOS
```

---

## Node.js Compatibility Matrix

| Node.js | Status | Storage | FTS5 | Notes |
|---------|--------|---------|------|-------|
| 24+ | Fully supported | `node:sqlite` (built-in) | Yes | Recommended |
| 22 LTS | Fully supported | `node:sqlite` (built-in) | Yes | Minimum recommended |
| 20 | Supported (fallback) | `sql.js` (+2MB) | Yes (sql.js bundles it) | EOL April 2026 |
| 18 | Deprecated | `sql.js` (+2MB) | Yes (sql.js bundles it) | EOL April 2025 |
| <18 | Not supported | — | — | — |

**Detection logic at startup:**
```typescript
async function initStorage(
  dbPath: string
): Promise<{ db: DatabaseAdapter; backend: string; fts5: boolean }> {
  // 1. Try node:sqlite
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(raw);
    const fts5 = detectFts5(db);
    return { db, backend: 'node:sqlite', fts5 };
  } catch {
    // node:sqlite not available (Node <22)
  }

  // 2. Fallback to sql.js
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SqlJsAdapter(SQL, dbPath);
  const fts5 = detectFts5(db);  // sql.js always has FTS5
  return { db, backend: 'sql.js', fts5 };
}
```

Logged at startup:
```
[locus] Storage: node:sqlite | FTS5: yes | DB: ~/.claude/memory/a1b2c3d4.db (24 KB)
```

---

## Observability & Debugging

### Logging

MCP servers run as stdio processes — no stdout available for logs.
All logging goes to a file:

```
~/.claude/memory/locus.log       <- rotating, max 1MB, last 3 files kept
```

**Log levels (configurable via env var `LOCUS_LOG`):**
```
LOCUS_LOG=error   -> errors only (default in production)
LOCUS_LOG=info    -> startup, scan results, memory operations
LOCUS_LOG=debug   -> full detail: every regex match, every SQL query, scan strategy decisions
```

**Security: logs never contain file content or secrets.**
Even at `debug` level, logs show metadata only:
```
[debug] scan: parsed src/auth/login.ts -> 3 exports, 4 imports, confidence: high
[debug] scan: skipped .env.local -> denylist match
[debug] hook: captured Read(src/utils/helpers.ts) -> status: success
[debug] search: FTS5 query "email validation" -> 3 results in 2ms
```
Never:
```
[debug] file content: const API_KEY = "sk-..."     <- NEVER LOGGED
[debug] tool output: { password: "..." }            <- NEVER LOGGED
```

### memory_doctor() — Self-Check Command

When something doesn't work, users shouldn't guess. `memory doctor` runs a full
environment check and tells the user exactly what's wrong and how to fix it.

```
$ /memory doctor

Locus Doctor — environment check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[OK]  Node.js: v22.11.0 (>= 22, node:sqlite available)
[OK]  Storage backend: node:sqlite
[OK]  FTS5: available (full-text search enabled)
[OK]  DB path: ~/.claude/memory/a1b2c3d4.db
[OK]  DB writable: yes (24 KB)
[OK]  Project root: ~/my-app (detected via git root)
[OK]  Git: available (incremental scan via git diff)
[OK]  Capture level: metadata (default, no raw content stored)
[OK]  Log file: ~/.claude/memory/locus.log (12 KB)
[OK]  Scanner: 47 files indexed, 3 skipped

All checks passed. Locus is healthy.
```

Failure example:
```
[OK]  Node.js: v20.11.0 (>= 20, sql.js fallback)
[WARN] Storage backend: sql.js (upgrade to Node 22+ for native sqlite)
[OK]  FTS5: available (via sql.js)
[FAIL] DB path: ~/.claude/memory/a1b2c3d4.db
       Error: EACCES — permission denied
       Fix: run "chmod 755 ~/.claude/memory" or check directory ownership
[OK]  Project root: ~/my-app (detected via git root)
[WARN] Capture level: full (WARNING: raw content is being stored!)
       Recommendation: set captureLevel to "metadata" or "redacted"

1 failure, 2 warnings. Run suggested fixes and try again.
```

**Checks performed:**
1. Node.js version and `node:sqlite` availability
2. FTS5 extension availability
3. DB file path exists, is writable, is not corrupt
4. Project root detection method (git root / marker file / cwd fallback)
5. Git availability (for incremental scan)
6. Capture level setting (warn if not `"metadata"`)
7. Disk space (warn if <100MB free)
8. Log file writable
9. Scanner state (files indexed, last scan time, any errors)
10. Potential secrets in stored data (quick scan)

### memory_status() Tool Output

```json
{
  "projectPath": "/home/user/my-app",
  "dbPath": "~/.claude/memory/a1b2c3d4.db",
  "dbSizeBytes": 24576,
  "nodeVersion": "v22.11.0",
  "storageBackend": "node:sqlite",
  "fts5Available": true,
  "structural": {
    "totalFiles": 47,
    "highConfidence": 44,
    "mediumConfidence": 3,
    "lastScan": "2026-02-18T10:30:00Z",
    "lastScanStrategy": "git-diff",
    "lastScanDurationMs": 82
  },
  "semantic": {
    "totalEntries": 8,
    "totalTokensEstimate": 320
  },
  "episodic": {
    "totalSessions": 12,
    "totalEntries": 34,
    "compressionMode": "threshold",
    "bufferTokens": 4200
  }
}
```

---

## Tech Stack

```
Runtime:        Node.js 22+ (recommended) / 20+ with sql.js fallback
Storage:        node:sqlite (built-in) / sql.js (fallback)
Search:         SQLite FTS5 (full-text search) / LIKE (last-resort fallback)
MCP SDK:        @modelcontextprotocol/sdk
Bundler:        esbuild (single file output)
Test:           vitest
Language:       TypeScript (strict, no any)
Linter:         biome (format + lint in one tool, fast)
Native deps:    ZERO
```

## Plugin Structure

```
locus/
  .claude-plugin/
    plugin.json              <- manifest (name, description, author)
  .mcp.json                  <- MCP server config
  hooks/
    post-tool-use.js         <- auto-capture context (with redaction)
  skills/
    memory/
      SKILL.md               <- /remember, /forget, /compact, /memory-status, /memory-doctor, /memory-audit, /memory-purge
  src/
    server.ts                <- MCP server entry point (stdio)
    storage/
      adapter.ts             <- DatabaseAdapter interface
      node-sqlite.ts         <- node:sqlite implementation
      sql-js.ts              <- sql.js fallback implementation
      migrations.ts          <- schema versioning & upgrades
      init.ts                <- detection logic, fallback chain
    scanner/
      index.ts               <- orchestrator: strategy selection, file walking
      parsers/
        typescript.ts        <- JS/TS export/import regex
        python.ts            <- Python class/def/import regex
        config.ts            <- package.json, tsconfig.json, pyproject.toml
      strip.ts               <- stripNonCode() — comment/string removal
      confidence.ts          <- confidence scoring logic
      aliases.ts             <- tsconfig path alias resolution
      ignore.ts              <- .gitignore + hardcoded ignore list
    memory/
      semantic.ts            <- Layer 2: decisions, context
      episodic.ts            <- Layer 3: session history
      compressor.ts          <- lazy compression engine
    security/
      redact.ts              <- content redaction patterns
      file-ignore.ts         <- file-level ignore rules (NEVER_READ_FILES)
    tools/
      explore.ts             <- memory_explore() implementation
      search.ts              <- memory_search() implementation
      remember.ts            <- memory_remember() implementation
      forget.ts              <- memory_forget() implementation
      scan.ts                <- memory_scan() implementation
      status.ts              <- memory_status() implementation
      doctor.ts              <- memory_doctor() self-check
      audit.ts               <- memory_audit() show stored data
      purge.ts               <- memory_purge() delete all
    resources/
      project-map.ts         <- memory://project-map resource
      decisions.ts           <- memory://decisions resource
      recent.ts              <- memory://recent resource
    logger.ts                <- file-based rotating logger
    utils.ts                 <- hash, path helpers
  tests/                     <- (see Testing Strategy section)
  package.json
  tsconfig.json
  biome.json
  esbuild.config.ts
  LICENSE                    <- MIT
  README.md
```

## Project Identity & Data Storage

### Project Identification (git root > cwd)

**Problem:** Using `cwd` hash as project ID breaks when the same project is opened
from different subdirectories:
```
~/my-app/                -> hash: a1b2c3d4
~/my-app/src/            -> hash: f5e6d7c8   <- WRONG: same project, different DB!
~/my-app/packages/web/   -> hash: 9a8b7c6d   <- WRONG: same monorepo, third DB!
```

**Solution:** Project ID = git root (when available), cwd as fallback:

```typescript
function resolveProjectRoot(cwd: string): string {
  // 1. Try git root (covers 99% of real projects)
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { cwd })
      .toString().trim();
    return gitRoot;
  } catch {
    // not a git repo
  }

  // 2. Look for project markers (package.json, pyproject.toml, Cargo.toml, go.mod)
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    for (const marker of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    dir = path.dirname(dir);
  }

  // 3. Fallback to cwd
  return cwd;
}

function projectHash(cwd: string): string {
  const root = resolveProjectRoot(cwd);
  const normalized = root.replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
```

**Result:**
```
~/my-app/                -> git root: ~/my-app  -> hash: a1b2c3d4
~/my-app/src/            -> git root: ~/my-app  -> hash: a1b2c3d4  <- SAME DB
~/my-app/packages/web/   -> git root: ~/my-app  -> hash: a1b2c3d4  <- SAME DB
~/random-folder/         -> no git, no markers   -> hash from cwd
```

### Storage Layout

```
~/.claude/memory/
  {project-hash-1}.db       <- project-isolated memory
  {project-hash-2}.db       <- another project
  global.db                 <- cross-project preferences (future)
  config.json               <- global Locus settings (captureLevel, logLevel)
  locus.log                 <- rotating log file
```

Project hash = SHA-256 of normalized project root path, truncated to 16 hex chars.
Full isolation between projects. DB files are local-only, never synced.

## Installation (Target UX)

```bash
# One command. Done.
claude plugin install github:YourName/locus

# Auto: npm install -> scan project -> ready
# No API keys. No VPS. No config. Local only.
```

**First-run experience:**
```
[locus] Scanning project... (47 files, 3 ignored)
[locus] Storage: node:sqlite | FTS5: yes
[locus] Structural map built in 1.2s (44 high confidence, 3 medium)
[locus] Ready. Memory attached to context.
[locus] Tip: use /remember to save project decisions.
```

---

## MVP Scope

**In (v1.0):**
- JS/TS + Python regex parsing with confidence tagging (with reasons)
- Re-export and barrel file detection
- tsconfig.json path alias resolution
- Scan limits: 1MB max file, binary detection, generated file tagging, symlink skip
- 3-layer memory (structural + semantic + episodic)
- node:sqlite with sql.js fallback (runtime detection)
- FTS5 with LIKE fallback (runtime detection)
- MCP Resources (compact, <3.5k tokens total) + Tools (on-demand)
- .gitignore respect + hardcoded ignore + denylist for secrets
- Three-tier incremental updates (git diff -> mtime -> full rescan)
- Metadata-only storage by default (no raw content), opt-in captureLevel
- Secret redaction as safety net for opt-in levels
- Project identity via git root (fallback: project marker, then cwd)
- /remember, /forget, /compact, /memory-status, /memory-doctor, /memory-audit, /memory-purge
- Lazy compression (threshold mode, configurable)
- Strict TypeScript, no `any`
- Vitest test suite: 200+ test cases
- File-based rotating logger with configurable levels, content-free by design
- CI: GitHub Actions matrix (Node 20/22/24 x Win/Linux/macOS)

**Out (v2+):**
- Go, Rust, Java parsing
- Semantic search (embeddings via local model)
- Entity relationship graph
- Memory export/import (JSON/markdown)
- Shared team memory (git-synced)
- Auto-pruning of stale data
- Web UI (localhost viewer) — visual memory browser
- Monorepo workspace awareness (pnpm/yarn/npm workspaces)
- Multi-language mixed project scoring
- Plugin marketplace listing

---

## Open Questions

- [x] Project name -> **Locus** (backup: Memoria)
- [x] Regex vs AST -> Regex with confidence tagging (see design decision)
- [x] Incremental updates -> Three-tier: git diff -> mtime -> full rescan
- [x] Secret protection -> Four-layer: metadata-only default + denylist + redaction + audit UX
- [x] Type safety -> Strict TypeScript, DatabaseAdapter interface, no any
- [x] Testing -> vitest, 200+ cases, CI matrix
- [x] Minimum Node.js -> 22+ recommended, 20+ supported with fallback
- [x] Project identity -> git root primary, project markers fallback, cwd last resort
- [x] Scan safety -> 1MB limit, binary detection, generated tagging, symlink skip
- [x] Trust UX -> /memory-audit, /memory-purge, /memory-doctor commands
- [x] Capture level -> metadata-only default, opt-in for redacted/full
- [ ] GitHub repo name: `locus`, `locus-mem`, or `locus-memory`?
- [ ] License: MIT (strong lean, need to finalize)
- [ ] Compression engine: Claude API directly or agent-sdk?
- [ ] README design: badges, demo GIF, benchmarks vs claude-mem?
- [ ] npm package name: `@locus/memory`, `locus-memory`, `claude-locus`?
- [ ] Benchmark methodology: what to measure? (tokens saved, scan time, accuracy)

---

## Honest Comparison with claude-mem

claude-mem is NOT bad — it has strong progressive disclosure (3-layer search: index -> timeline -> details).
But it focuses on **agent action history**, not **project understanding**.

| Feature                    | claude-mem        | Locus                    |
|----------------------------|-------------------|--------------------------|
| Remembers agent actions    | **Yes, excellent** | Yes (episodic layer)     |
| Progressive disclosure     | **Yes, 3 layers** | Yes (resource + tools)   |
| Structural project map     | **No**            | Yes (regex scanner)      |
| Project isolation          | No                | Yes (git-root-based .db) |
| Default data policy        | Stores tool output| Metadata-only (no content)|
| Secret redaction           | No                | Yes (4-layer defense)    |
| Self-check / doctor        | No                | Yes (/memory-doctor)     |
| Audit / purge              | No                | Yes (/memory-audit, purge)|
| Windows support            | Broken (5+ bugs)  | Works (zero native deps) |
| Dependencies               | Bun + uv + Chroma | 0 native deps            |
| Incremental updates        | Unknown           | git diff + mtime + full  |
| Web UI                     | **Yes (localhost)**| No (planned v2)          |
| Semantic search (vectors)  | **Yes (ChromaDB)** | No (FTS5, planned v2)   |
| Type safety                | Unknown           | Strict TS, no any        |
| Test coverage              | Unknown           | 200+ test cases          |

Locus is NOT a claude-mem replacement. It's a **different niche**: project-aware memory vs action-history memory.

---

*Document created: 2026-02-17*
*Last updated: 2026-02-18 (rev 4) — added: Contract 9 (purge two-call pattern), exitCode in metadata, ErrorKind enum replacing raw error messages, brace depth tracking in stripNonCode, regex literal explicit exclusion, rescan absolute threshold + cooldown, repo-level vs package-level scope clarification*
*Status: Architecture hardened after four rounds of external review. 9 binding contracts. All ambiguities resolved. Ready for implementation.*
