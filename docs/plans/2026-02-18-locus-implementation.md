# Locus Memory Plugin — Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all 29 stub modules of the Locus persistent memory plugin for Claude Code, transforming the scaffold into a fully working MCP server with structural scanning, semantic/episodic memory, and 9 tools.

**Architecture:** Three-layer memory (structural regex-parsed map + semantic decisions + episodic session history) backed by SQLite (node:sqlite primary, sql.js fallback). MCP server exposes 3 auto-injected resources (<3.5k tokens) and 9 on-demand tools. All contracts from ARCHITECTURE.md are binding.

**Tech Stack:** TypeScript strict (no any), node:sqlite / sql.js, FTS5, @modelcontextprotocol/sdk, vitest, esbuild, biome

---

## Subagent Model Policy (MANDATORY)

Every Task tool call MUST include explicit `model` parameter:

| Model | When to use | Examples |
|-------|-------------|---------|
| **Sonnet 4.6** (`model: "sonnet"`) | DEFAULT for all code-writing tasks | Tasks 1-3, 5-14, 17-19, 21-28 |
| **Haiku 4.5** (`model: "haiku"`) | Search and exploration ONLY. Never writes code. | Explore agent, codebase research |
| **Opus 4.6** (`model: "opus"`) | Very complex logic only. Use sparingly. | Task 4 (stripNonCode state machine), Task 15-16 (scan orchestrator), Task 30 (server wiring) |

**Rule:** If a subagent writes or modifies code, it MUST be Sonnet or Opus. Haiku NEVER touches code.

---

## Dependency Graph

```
Layer 0 (no deps):       logger, redact, file-ignore, stripNonCode, utils (ALL DONE)
Layer 1 (logger):        NodeSqliteAdapter, SqlJsAdapter, migrations, initStorage
Layer 2 (strip+ignore):  TS parser, Python parser, config parser, aliases, confidence, ignore
Layer 3 (L1+L2):         chooseScanStrategy, scanProject
Layer 4 (L1):            SemanticMemory, EpisodicMemory, MemoryCompressor
Layer 5 (L1+L3):         project-map resource, decisions resource, recent resource
Layer 6 (all above):     9 tool handlers (explore, search, remember, forget, scan, status, doctor, audit, purge)
Layer 7 (L1+security):   post-tool-use hook
Layer 8 (all):           server.ts wiring + E2E tests
```

Tasks are numbered in implementation order. Each task is atomic and TDD.

---

### Task 1: File-based rotating logger [DONE — b92d5ea]

**Files:**
- Modify: `src/logger.ts`
- Create: `tests/logger.test.ts`

**Context:** Currently logger writes to stderr. Need file-based rotation per ARCHITECTURE.md: `~/.claude/memory/locus.log`, max 1MB, last 3 files kept. Content-free by design (Contract 3). Also needs `maskPath()` utility.

**Step 1: Write the failing tests**

```typescript
// tests/logger.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Logger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-log-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes log entries to file', async () => {
    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug');
    logger.info('test message');
    logger.close();
    const content = readFileSync(join(tempDir, 'locus.log'), 'utf-8');
    expect(content).toContain('test message');
    expect(content).toContain('[info]');
  });

  it('respects log level filtering', async () => {
    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger(join(tempDir, 'locus.log'), 'error');
    logger.info('should not appear');
    logger.error('should appear');
    logger.close();
    const content = readFileSync(join(tempDir, 'locus.log'), 'utf-8');
    expect(content).not.toContain('should not appear');
    expect(content).toContain('should appear');
  });

  it('rotates when file exceeds maxSize', async () => {
    const { createLogger } = await import('../src/logger.js');
    const maxSize = 500; // small size for testing
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug', maxSize);
    for (let i = 0; i < 100; i++) {
      logger.debug(`line ${i} padding ${'x'.repeat(20)}`);
    }
    logger.close();
    expect(existsSync(join(tempDir, 'locus.log'))).toBe(true);
    expect(existsSync(join(tempDir, 'locus.log.1'))).toBe(true);
  });

  it('keeps at most 3 rotated files', async () => {
    const { createLogger } = await import('../src/logger.js');
    const maxSize = 200;
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug', maxSize);
    for (let i = 0; i < 500; i++) {
      logger.debug(`line ${i} ${'x'.repeat(50)}`);
    }
    logger.close();
    expect(existsSync(join(tempDir, 'locus.log'))).toBe(true);
    // Should not have more than 3 backup files
    expect(existsSync(join(tempDir, 'locus.log.4'))).toBe(false);
  });
});

describe('maskPath', () => {
  it('returns path unchanged when disabled', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('/home/user/project/src/auth/login.ts', false))
      .toBe('/home/user/project/src/auth/login.ts');
  });

  it('masks long paths keeping last 3 components', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('/home/user/secret-client/internal-api/src/auth/login.ts', true))
      .toBe('****/src/auth/login.ts');
  });

  it('does not mask short paths', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('src/auth/login.ts', true)).toBe('src/auth/login.ts');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL (createLogger and maskPath don't exist yet)

**Step 3: Implement the logger**

Replace `src/logger.ts` with full implementation:
- `createLogger(logPath, level, maxSize=1048576)` returns `{ error, info, debug, close }`
- Uses `appendFileSync` for writes (sync to avoid losing logs on crash)
- Rotation: on each write, check size; if > maxSize, rename `.log` -> `.log.1`, etc., delete `.log.3+`
- `maskPath(path, enabled)` per Contract 3
- Export `setLogLevel` for compatibility with existing server.ts import

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logger.test.ts`
Expected: PASS

**Step 5: Run full check**

Run: `npm run check`
Expected: typecheck + lint + all tests pass

**Step 6: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: implement file-based rotating logger with maskPath (Contract 3)"
```

---

### Task 2: Content redaction patterns [DONE — 0159d4a]

**Files:**
- Modify: `src/security/redact.ts`
- Create: `tests/security/redact.test.ts`

**Context:** Implement all REDACT_PATTERNS from ARCHITECTURE.md Problem 7. The `redact()` function is the safety net for opt-in captureLevel. Must catch real secrets, must NOT over-redact normal code.

**Step 1: Write the failing tests**

```typescript
// tests/security/redact.test.ts
import { describe, expect, it } from 'vitest';
import { redact } from '../../src/security/redact.js';

describe('redact', () => {
  // --- Must redact ---
  it('redacts OpenAI API keys', () => {
    expect(redact('key=sk-abc123def456ghi789jkl'))
      .toContain('[REDACTED]');
    expect(redact('key=sk-abc123def456ghi789jkl'))
      .not.toContain('abc123');
  });

  it('redacts GitHub PATs', () => {
    expect(redact('ghp_1234567890abcdefghijklmnopqrstuvwxyz'))
      .toBe('ghp_[REDACTED]');
  });

  it('redacts GitLab PATs', () => {
    expect(redact('glpat-xxxxxxxxxxxxxxxxxxxx'))
      .toBe('glpat-[REDACTED]');
  });

  it('redacts Slack tokens', () => {
    expect(redact('xoxb-123456789-abcdefgh'))
      .toBe('xox_-[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy'))
      .toContain('Bearer [REDACTED]');
  });

  it('redacts AWS access keys', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE'))
      .toBe('AKIA[REDACTED]');
  });

  it('redacts connection strings', () => {
    expect(redact('postgres://user:password@host:5432/db'))
      .toBe('postgres://[REDACTED]');
    expect(redact('mongodb://admin:secret@cluster.mongodb.net/mydb'))
      .toBe('mongodb://[REDACTED]');
  });

  it('redacts KEY=VALUE patterns', () => {
    expect(redact('API_KEY=some_long_secret_value_here'))
      .toBe('API_KEY=[REDACTED]');
    expect(redact('DATABASE_PASSWORD: "supersecret123"'))
      .toContain('[REDACTED]');
  });

  it('redacts private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...content...\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[REDACTED_PRIVATE_KEY]');
  });

  // --- Must NOT redact (false positive protection) ---
  it('does not redact function names with token/key in name', () => {
    expect(redact('export function validateToken(token: string) {}'))
      .toBe('export function validateToken(token: string) {}');
  });

  it('does not redact short constants', () => {
    expect(redact('const MAX_TOKEN_LENGTH = 256'))
      .toBe('const MAX_TOKEN_LENGTH = 256');
  });

  it('does not redact import statements mentioning secrets', () => {
    expect(redact('import { SECRET_MANAGER } from "./config"'))
      .toBe('import { SECRET_MANAGER } from "./config"');
  });

  it('does not redact comments about passwords', () => {
    expect(redact('// This is a comment about password hashing'))
      .toBe('// This is a comment about password hashing');
  });

  it('does not redact base64 of short strings', () => {
    expect(redact('const base64 = btoa("hello world")'))
      .toBe('const base64 = btoa("hello world")');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/security/redact.test.ts`
Expected: FAIL (redact returns text unchanged)

**Step 3: Implement redaction patterns**

Fill in `REDACT_PATTERNS` array in `src/security/redact.ts` with all patterns from ARCHITECTURE.md section "Layer 2 -- Content Redaction". The `redact()` function loop is already in place, just fill the patterns array.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/redact.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/security/redact.ts tests/security/redact.test.ts
git commit -m "feat: implement content redaction patterns (Contract 1 Layer 2)"
```

---

### Task 3: File denylist matching [DONE — 0159d4a]

**Files:**
- Modify: `src/security/file-ignore.ts`
- Create: `tests/security/file-ignore.test.ts`

**Context:** `isDenylisted(filePath)` must match against DENYLIST_FILES patterns. Patterns include globs (*.pem, .env.*, **/secrets/**). Must handle Windows and Unix paths.

**Step 1: Write the failing tests**

```typescript
// tests/security/file-ignore.test.ts
import { describe, expect, it } from 'vitest';
import { isDenylisted, DENYLIST_FILES } from '../../src/security/file-ignore.js';

describe('isDenylisted', () => {
  it('blocks .env files', () => {
    expect(isDenylisted('.env')).toBe(true);
    expect(isDenylisted('.env.local')).toBe(true);
    expect(isDenylisted('.env.production')).toBe(true);
  });

  it('blocks crypto key files', () => {
    expect(isDenylisted('server.pem')).toBe(true);
    expect(isDenylisted('tls.key')).toBe(true);
    expect(isDenylisted('cert.p12')).toBe(true);
    expect(isDenylisted('keystore.jks')).toBe(true);
  });

  it('blocks SSH keys', () => {
    expect(isDenylisted('id_rsa')).toBe(true);
    expect(isDenylisted('id_ed25519')).toBe(true);
  });

  it('blocks credential files', () => {
    expect(isDenylisted('credentials.json')).toBe(true);
    expect(isDenylisted('secrets.yaml')).toBe(true);
    expect(isDenylisted('service-account-prod.json')).toBe(true);
  });

  it('blocks rc files with tokens', () => {
    expect(isDenylisted('.npmrc')).toBe(true);
    expect(isDenylisted('.pypirc')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(isDenylisted('src/auth/login.ts')).toBe(false);
    expect(isDenylisted('package.json')).toBe(false);
    expect(isDenylisted('README.md')).toBe(false);
    expect(isDenylisted('test.js')).toBe(false);
  });

  it('handles nested paths', () => {
    expect(isDenylisted('config/.env')).toBe(true);
    expect(isDenylisted('deploy/certs/server.pem')).toBe(true);
  });

  it('DENYLIST_FILES is non-empty', () => {
    expect(DENYLIST_FILES.length).toBeGreaterThan(10);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/security/file-ignore.test.ts`
Expected: FAIL (isDenylisted returns false)

**Step 3: Implement denylist matching**

Implement `isDenylisted()` in `src/security/file-ignore.ts`:
- Extract the filename (basename) from the path
- Match against DENYLIST_FILES patterns using simple glob matching
- `*` matches any characters within a component, `**` matches across path separators
- Implement a lightweight `matchGlob(pattern, filename)` helper (no deps)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/file-ignore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/security/file-ignore.ts tests/security/file-ignore.test.ts
git commit -m "feat: implement file denylist matching (Contract 1 Layer 1)"
```

---

### Task 4: stripNonCode state machine [DONE — 0159d4a]

**Files:**
- Modify: `src/scanner/strip.ts`
- Create: `tests/scanner/strip-non-code.test.ts`

**Context:** This is Contract 4 -- the most complex pure-logic piece. Single-pass character-level state machine with stack + brace depth. Must strip comments and string content, preserve code inside `${}`, preserve line breaks.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/strip-non-code.test.ts
import { describe, expect, it } from 'vitest';
import { stripNonCode } from '../../src/scanner/strip.js';

describe('stripNonCode', () => {
  // --- Basic stripping ---
  it('strips double-quoted strings', () => {
    expect(stripNonCode('const s = "hello";')).toBe('const s = "";');
  });

  it('strips single-quoted strings', () => {
    expect(stripNonCode("const s = 'hello';")).toBe('const s = "";');
  });

  it('strips line comments', () => {
    expect(stripNonCode('// comment\nexport const x = 1'))
      .toBe('\nexport const x = 1');
  });

  it('strips block comments', () => {
    expect(stripNonCode('/* block */ export const y = 1'))
      .toBe(' export const y = 1');
  });

  // --- Escaped quotes ---
  it('handles escaped single quotes', () => {
    expect(stripNonCode("const s = 'it\\'s fine';")).toBe('const s = "";');
  });

  it('handles escaped double quotes', () => {
    expect(stripNonCode('const s = "say \\"hello\\"";')).toBe('const s = "";');
  });

  // --- Template literals ---
  it('strips simple template literal content', () => {
    expect(stripNonCode('const x = `hello`;')).toBe('const x = ``;');
  });

  it('preserves code inside template expressions', () => {
    expect(stripNonCode('const x = `${a + b}`;')).toBe('const x = `a + b`;');
  });

  it('strips strings inside template expressions', () => {
    expect(stripNonCode('const x = `${fn("arg")}`;')).toBe('const x = `fn("")`;');
  });

  // --- Nested templates ---
  it('handles nested template literals', () => {
    expect(stripNonCode('`a${`b${c}`}d`')).toBe('``c``');
  });

  it('handles string indexing inside template', () => {
    expect(stripNonCode('`${obj["key"]}`')).toBe('`obj[""]`');
  });

  // --- Brace depth ---
  it('handles arrow functions in template expressions', () => {
    expect(stripNonCode('`${items.map(x => { return x; })}`'))
      .toBe('`items.map(x => { return x; })`');
  });

  it('handles object literals in template expressions', () => {
    expect(stripNonCode('`${{ a: 1 }}`')).toBe('`{ a: 1 }`');
  });

  // --- Dynamic imports (must be preserved) ---
  it('preserves import() inside template expression', () => {
    expect(stripNonCode('`${import("./module")}`')).toBe('`import("")`');
  });

  it('preserves await import() inside template expression', () => {
    expect(stripNonCode('`${await import("./x")}`')).toBe('`await import("")`');
  });

  // --- Line preservation ---
  it('preserves line breaks in comments', () => {
    const input = 'line1\n// comment\nline3';
    const result = stripNonCode(input);
    expect(result.split('\n').length).toBe(3);
  });

  // --- Regex literals pass through (explicit non-handling) ---
  it('passes regex literals through unchanged', () => {
    expect(stripNonCode('const re = /test/g;')).toBe('const re = /test/g;');
  });

  // --- Mixed ---
  it('handles mixed content', () => {
    const input = 'export const x = `hello`; // comment';
    const result = stripNonCode(input);
    expect(result).toContain('export const x = ``');
    expect(result).not.toContain('comment');
  });

  // --- Empty / edge cases ---
  it('handles empty string', () => {
    expect(stripNonCode('')).toBe('');
  });

  it('handles code with no comments or strings', () => {
    expect(stripNonCode('const x = 1 + 2;')).toBe('const x = 1 + 2;');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/strip-non-code.test.ts`
Expected: FAIL (stripNonCode returns source unchanged)

**Step 3: Implement the state machine**

Replace `src/scanner/strip.ts` with the full state machine from ARCHITECTURE.md Contract 4.
Keep the `StripState` type. Implement `stripNonCode()` with:
- `StripContext` with state, stack, braceDepth, output array, index
- Switch on 6 states: CODE, LINE_COMMENT, BLOCK_COMMENT, SQ_STRING, DQ_STRING, TEMPLATE
- Stack push/pop for `${...}` expressions
- Brace depth tracking for `{}` inside expressions

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/strip-non-code.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/strip.ts tests/scanner/strip-non-code.test.ts
git commit -m "feat: implement stripNonCode state machine (Contract 4)"
```

---

### Task 5: TypeScript/JavaScript export/import parser [DONE — 0159d4a]

**Files:**
- Modify: `src/scanner/parsers/typescript.ts`
- Create: `tests/scanner/parsers/typescript.test.ts`

**Context:** Regex-based parsing of JS/TS exports, imports, and re-exports. Applied AFTER stripNonCode. Patterns from ARCHITECTURE.md "Regex patterns (MVP)".

**Step 1: Write the failing tests**

```typescript
// tests/scanner/parsers/typescript.test.ts
import { describe, expect, it } from 'vitest';
import { parseExports, parseImports, parseReExports } from '../../../src/scanner/parsers/typescript.js';

describe('parseExports', () => {
  it('parses named function export', () => {
    const result = parseExports('export function foo() {}');
    expect(result).toEqual([{ name: 'foo', kind: 'function', isDefault: false, isTypeOnly: false }]);
  });

  it('parses default class export', () => {
    const result = parseExports('export default class App {}');
    expect(result).toEqual([{ name: 'App', kind: 'class', isDefault: true, isTypeOnly: false }]);
  });

  it('parses const export', () => {
    const result = parseExports('export const BAR = 1');
    expect(result).toEqual([{ name: 'BAR', kind: 'const', isDefault: false, isTypeOnly: false }]);
  });

  it('parses type export', () => {
    const result = parseExports('export type User = { id: string }');
    expect(result).toEqual([{ name: 'User', kind: 'type', isDefault: false, isTypeOnly: true }]);
  });

  it('parses interface export', () => {
    const result = parseExports('export interface Config {}');
    expect(result).toEqual([{ name: 'Config', kind: 'interface', isDefault: false, isTypeOnly: true }]);
  });

  it('parses enum export', () => {
    const result = parseExports('export enum Status { Active }');
    expect(result).toEqual([{ name: 'Status', kind: 'enum', isDefault: false, isTypeOnly: false }]);
  });

  it('parses anonymous default export', () => {
    const result = parseExports('export default function() {}');
    expect(result).toEqual([{ name: '[default]', kind: 'function', isDefault: true, isTypeOnly: false }]);
  });

  it('parses multiple exports from multiline source', () => {
    const source = 'export const A = 1;\nexport function B() {}\nexport class C {}';
    const result = parseExports(source);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('returns empty for no exports', () => {
    expect(parseExports('const x = 1;')).toEqual([]);
  });
});

describe('parseImports', () => {
  it('parses named import', () => {
    const result = parseImports("import { foo } from 'bar'");
    expect(result).toEqual([{ source: 'bar', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses default import', () => {
    const result = parseImports("import React from 'react'");
    expect(result).toEqual([{ source: 'react', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses type-only import', () => {
    const result = parseImports("import type { Config } from './config'");
    expect(result).toEqual([{ source: './config', isTypeOnly: true, isDynamic: false }]);
  });

  it('parses dynamic import with literal string', () => {
    const result = parseImports("const m = await import('./utils')");
    expect(result).toEqual([{ source: './utils', isTypeOnly: false, isDynamic: true }]);
  });

  it('parses multiple imports', () => {
    const source = "import { a } from 'x';\nimport { b } from 'y';";
    expect(parseImports(source)).toHaveLength(2);
  });

  it('deduplicates same source', () => {
    const source = "import { a } from 'x';\nimport { b } from 'x';";
    expect(parseImports(source)).toHaveLength(1);
  });
});

describe('parseReExports', () => {
  it('parses named re-export', () => {
    const result = parseReExports("export { foo, bar } from './utils'");
    expect(result).toEqual([{ source: './utils', names: ['foo', 'bar'] }]);
  });

  it('parses wildcard re-export', () => {
    const result = parseReExports("export * from './types'");
    expect(result).toEqual([{ source: './types', names: '*' }]);
  });

  it('parses namespace re-export', () => {
    const result = parseReExports("export * as utils from './utils'");
    expect(result).toEqual([{ source: './utils', names: '*' }]);
  });

  it('parses type-only re-export', () => {
    const result = parseReExports("export type { User } from './models'");
    expect(result).toEqual([{ source: './models', names: ['User'] }]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/parsers/typescript.test.ts`
Expected: FAIL (all parsers return empty arrays)

**Step 3: Implement the parsers**

Implement in `src/scanner/parsers/typescript.ts`:
- `parseExports(source: string): ExportEntry[]` -- apply named export regex line-by-line
- `parseImports(source: string): ImportEntry[]` -- static + dynamic import regex, deduplicate
- `parseReExports(source: string): ReExportEntry[]` -- named re-export + wildcard re-export regex

All regex patterns are specified in ARCHITECTURE.md "Regex patterns (MVP)" section.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/parsers/typescript.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/parsers/typescript.ts tests/scanner/parsers/typescript.test.ts
git commit -m "feat: implement JS/TS export/import/re-export regex parsers"
```

---

### Task 6: Python export/import parser [DONE]

**Files:**
- Modify: `src/scanner/parsers/python.ts`
- Create: `tests/scanner/parsers/python.test.ts`

**Context:** Parse Python `class`, `def`, `from X import Y`, `import X`. Skip `_private` defs.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/parsers/python.test.ts
import { describe, expect, it } from 'vitest';
import { parsePythonExports, parsePythonImports } from '../../../src/scanner/parsers/python.js';

describe('parsePythonExports', () => {
  it('parses class definition', () => {
    const result = parsePythonExports('class UserService:');
    expect(result).toEqual([{ name: 'UserService', kind: 'class', isDefault: false, isTypeOnly: false }]);
  });

  it('parses function definition', () => {
    const result = parsePythonExports('def process_data():');
    expect(result).toEqual([{ name: 'process_data', kind: 'function', isDefault: false, isTypeOnly: false }]);
  });

  it('skips private functions (underscore prefix)', () => {
    const result = parsePythonExports('def _internal_helper():');
    expect(result).toEqual([]);
  });

  it('skips dunder methods', () => {
    const result = parsePythonExports('def __init__(self):');
    expect(result).toEqual([]);
  });

  it('parses multiple definitions', () => {
    const source = 'class Foo:\n  pass\n\ndef bar():\n  pass\n\ndef _private():\n  pass';
    const result = parsePythonExports(source);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.name)).toEqual(['Foo', 'bar']);
  });
});

describe('parsePythonImports', () => {
  it('parses from-import', () => {
    const result = parsePythonImports('from flask import Flask');
    expect(result).toEqual([{ source: 'flask', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses plain import', () => {
    const result = parsePythonImports('import os');
    expect(result).toEqual([{ source: 'os', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses relative import', () => {
    const result = parsePythonImports('from .utils import helper');
    expect(result).toEqual([{ source: '.utils', isTypeOnly: false, isDynamic: false }]);
  });

  it('parses multiple imports', () => {
    const source = 'import os\nfrom sys import argv\nimport json';
    expect(parsePythonImports(source)).toHaveLength(3);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/parsers/python.test.ts`
Expected: FAIL

**Step 3: Implement the parsers**

Implement in `src/scanner/parsers/python.ts`:
- `parsePythonExports(source)` -- `^class\s+(\w+)` and `^def\s+(\w+)` (skip `_prefix`)
- `parsePythonImports(source)` -- `^from\s+(\S+)\s+import` and `^import\s+(\S+)`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/parsers/python.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/parsers/python.ts tests/scanner/parsers/python.test.ts
git commit -m "feat: implement Python class/def/import regex parsers"
```

---

### Task 7: Config file parser (package.json, tsconfig.json) [DONE]

**Files:**
- Modify: `src/scanner/parsers/config.ts`
- Create: `tests/scanner/parsers/config.test.ts`

**Context:** Extract stack info from package.json (dependencies, scripts, workspaces) and path aliases from tsconfig.json.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/parsers/config.test.ts
import { describe, expect, it } from 'vitest';
import { parsePackageJson, parseTsConfig } from '../../../src/scanner/parsers/config.js';

describe('parsePackageJson', () => {
  it('extracts dependencies as stack', () => {
    const result = parsePackageJson(JSON.stringify({
      dependencies: { express: '^4.0.0', prisma: '^5.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    }));
    expect(result.stack).toContain('express');
    expect(result.stack).toContain('prisma');
  });

  it('extracts script names', () => {
    const result = parsePackageJson(JSON.stringify({
      scripts: { build: 'tsc', test: 'vitest', dev: 'nodemon' },
    }));
    expect(result.scripts).toEqual(['build', 'test', 'dev']);
  });

  it('extracts dependency names', () => {
    const result = parsePackageJson(JSON.stringify({
      dependencies: { react: '18.0.0' },
      devDependencies: { typescript: '5.0.0' },
    }));
    expect(result.dependencies).toContain('react');
    expect(result.dependencies).toContain('typescript');
  });

  it('handles missing fields gracefully', () => {
    const result = parsePackageJson('{}');
    expect(result.stack).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });

  it('handles invalid JSON', () => {
    const result = parsePackageJson('not json');
    expect(result.stack).toEqual([]);
  });
});

describe('parseTsConfig', () => {
  it('extracts path aliases', () => {
    const result = parseTsConfig(JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['./src/*'], '@utils/*': ['./src/utils/*'] },
      },
    }));
    expect(result).toEqual({
      '@/*': './src/*',
      '@utils/*': './src/utils/*',
    });
  });

  it('returns empty for no paths', () => {
    const result = parseTsConfig(JSON.stringify({ compilerOptions: {} }));
    expect(result).toEqual({});
  });

  it('handles invalid JSON', () => {
    const result = parseTsConfig('not json');
    expect(result).toEqual({});
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/parsers/config.test.ts`
Expected: FAIL

**Step 3: Implement the parsers**

Implement in `src/scanner/parsers/config.ts`:
- `parsePackageJson(content)` -- JSON.parse, extract dependency names, script names
- `parseTsConfig(content)` -- JSON.parse, extract `compilerOptions.paths`, map to first entry of each alias

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/parsers/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/parsers/config.ts tests/scanner/parsers/config.test.ts
git commit -m "feat: implement package.json and tsconfig.json parsers"
```

---

### Task 8: Path alias resolution

**Files:**
- Modify: `src/scanner/aliases.ts`
- Create: `tests/scanner/aliases.test.ts`

**Context:** Load path aliases from tsconfig.json, resolve `@/auth/login` -> `src/auth/login`.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/aliases.test.ts
import { describe, expect, it } from 'vitest';
import { loadPathAliases, resolveAlias } from '../../src/scanner/aliases.js';
import type { PathAliasMap } from '../../src/scanner/aliases.js';

describe('loadPathAliases', () => {
  it('loads aliases from tsconfig paths', () => {
    const aliases = loadPathAliases({
      '@/*': './src/*',
      '@utils/*': './src/utils/*',
    });
    expect(aliases['@/*']).toBe('./src/*');
  });

  it('returns empty for empty input', () => {
    expect(loadPathAliases({})).toEqual({});
  });
});

describe('resolveAlias', () => {
  const aliases: PathAliasMap = {
    '@/*': './src/*',
    '@utils/*': './src/utils/*',
  };

  it('resolves @ alias to src path', () => {
    expect(resolveAlias('@/auth/login', aliases)).toBe('src/auth/login');
  });

  it('resolves @utils alias', () => {
    expect(resolveAlias('@utils/helpers', aliases)).toBe('src/utils/helpers');
  });

  it('returns undefined for non-alias path', () => {
    expect(resolveAlias('./local-file', aliases)).toBeUndefined();
  });

  it('returns undefined for npm package', () => {
    expect(resolveAlias('react', aliases)).toBeUndefined();
  });

  it('picks longest matching prefix', () => {
    expect(resolveAlias('@utils/deep/file', aliases)).toBe('src/utils/deep/file');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/aliases.test.ts`
Expected: FAIL

**Step 3: Implement alias resolution**

Implement in `src/scanner/aliases.ts`:
- `loadPathAliases(rawPaths)` -- normalize the paths map
- `resolveAlias(importPath, aliases)` -- match against alias prefixes (longest first), substitute with target path, strip leading `./`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/aliases.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/aliases.ts tests/scanner/aliases.test.ts
git commit -m "feat: implement tsconfig path alias resolution"
```

---

### Task 9: Ignore rules (shouldIgnore)

**Files:**
- Modify: `src/scanner/ignore.ts`
- Create: `tests/scanner/ignore.test.ts`

**Context:** `shouldIgnore(filePath)` must check against HARDCODED_IGNORE list (glob patterns) + respect .gitignore entries. For MVP, start with HARDCODED_IGNORE matching only; .gitignore integration can come in the scan orchestrator.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/ignore.test.ts
import { describe, expect, it } from 'vitest';
import { shouldIgnore, HARDCODED_IGNORE } from '../../src/scanner/ignore.js';

describe('shouldIgnore', () => {
  it('ignores node_modules', () => {
    expect(shouldIgnore('node_modules/react/index.js')).toBe(true);
  });

  it('ignores .git', () => {
    expect(shouldIgnore('.git/config')).toBe(true);
  });

  it('ignores dist', () => {
    expect(shouldIgnore('dist/server.js')).toBe(true);
  });

  it('ignores .d.ts files', () => {
    expect(shouldIgnore('src/types.d.ts')).toBe(true);
  });

  it('ignores .min.js files', () => {
    expect(shouldIgnore('vendor/jquery.min.js')).toBe(true);
  });

  it('ignores .map files', () => {
    expect(shouldIgnore('dist/app.js.map')).toBe(true);
  });

  it('ignores package-lock.json', () => {
    expect(shouldIgnore('package-lock.json')).toBe(true);
  });

  it('ignores coverage directory', () => {
    expect(shouldIgnore('coverage/lcov.info')).toBe(true);
  });

  it('ignores __pycache__', () => {
    expect(shouldIgnore('__pycache__/module.pyc')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(shouldIgnore('src/auth/login.ts')).toBe(false);
    expect(shouldIgnore('tests/unit/auth.test.ts')).toBe(false);
    expect(shouldIgnore('README.md')).toBe(false);
  });

  it('HARDCODED_IGNORE has expected entries', () => {
    expect(HARDCODED_IGNORE).toContain('node_modules');
    expect(HARDCODED_IGNORE).toContain('.git');
    expect(HARDCODED_IGNORE).toContain('dist');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/ignore.test.ts`
Expected: FAIL (shouldIgnore returns false)

**Step 3: Implement shouldIgnore**

Implement in `src/scanner/ignore.ts`:
- Split path into components
- Check if any path component matches a directory name in HARDCODED_IGNORE
- Check if filename matches a glob pattern in HARDCODED_IGNORE (e.g., `*.min.js`, `*.d.ts`)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/ignore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/ignore.ts tests/scanner/ignore.test.ts
git commit -m "feat: implement ignore rules with hardcoded ignore list"
```

---

### Task 10: Confidence scoring

**Files:**
- Modify: `src/scanner/confidence.ts`
- Create: `tests/scanner/confidence.test.ts`

**Context:** Compute confidence per ARCHITECTURE.md heuristics: barrel detection, dynamic imports, large files, generated files, unresolved aliases, multiline exports.

**Step 1: Write the failing tests**

```typescript
// tests/scanner/confidence.test.ts
import { describe, expect, it } from 'vitest';
import { computeConfidence } from '../../src/scanner/confidence.js';
import type { ExportEntry, ImportEntry, ReExportEntry } from '../../src/types.js';

describe('computeConfidence', () => {
  const noExports: ExportEntry[] = [];
  const noImports: ImportEntry[] = [];
  const noReExports: ReExportEntry[] = [];

  it('returns high for normal module', () => {
    const exports: ExportEntry[] = [
      { name: 'foo', kind: 'function', isDefault: false, isTypeOnly: false },
    ];
    const result = computeConfidence({
      exports, imports: noImports, reExports: noReExports,
      lines: 50, hasGeneratedHeader: false, hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'high' });
  });

  it('returns medium:barrel for barrel file', () => {
    const reExports: ReExportEntry[] = [{ source: './login', names: '*' }];
    const result = computeConfidence({
      exports: noExports, imports: noImports, reExports,
      lines: 3, hasGeneratedHeader: false, hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'barrel' });
  });

  it('returns medium:dynamic-import when present', () => {
    const result = computeConfidence({
      exports: noExports, imports: noImports, reExports: noReExports,
      lines: 50, hasGeneratedHeader: false, hasDynamicImport: true,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'dynamic-import' });
  });

  it('returns medium:generated for auto-generated files', () => {
    const result = computeConfidence({
      exports: noExports, imports: noImports, reExports: noReExports,
      lines: 50, hasGeneratedHeader: true, hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'generated' });
  });

  it('returns medium:large-file for >500 LOC', () => {
    const result = computeConfidence({
      exports: noExports, imports: noImports, reExports: noReExports,
      lines: 600, hasGeneratedHeader: false, hasDynamicImport: false,
      hasUnresolvedAlias: false,
    });
    expect(result).toEqual({ level: 'medium', reason: 'large-file' });
  });

  it('returns medium:alias-unresolved when alias failed', () => {
    const result = computeConfidence({
      exports: noExports, imports: noImports, reExports: noReExports,
      lines: 50, hasGeneratedHeader: false, hasDynamicImport: false,
      hasUnresolvedAlias: true,
    });
    expect(result).toEqual({ level: 'medium', reason: 'alias-unresolved' });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/confidence.test.ts`
Expected: FAIL

**Step 3: Implement confidence scoring**

Implement in `src/scanner/confidence.ts`:
- Accept analysis results, return `Confidence` object
- Priority: barrel > dynamic-import > generated > large-file > alias-unresolved > high

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/confidence.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/confidence.ts tests/scanner/confidence.test.ts
git commit -m "feat: implement confidence scoring with reasons"
```

---

### Task 11: NodeSqliteAdapter

**Files:**
- Modify: `src/storage/node-sqlite.ts`
- Create: `tests/storage/node-sqlite.test.ts`

**Context:** Wraps `node:sqlite` DatabaseSync. Only runs on Node 22+. Tests should be conditional (skip if node:sqlite unavailable).

**Step 1: Write the failing tests**

```typescript
// tests/storage/node-sqlite.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Skip entire suite if node:sqlite is not available
let hasNodeSqlite = false;
try {
  await import('node:sqlite');
  hasNodeSqlite = true;
} catch {}

describe.skipIf(!hasNodeSqlite)('NodeSqliteAdapter', () => {
  let tempDir: string;
  let adapter: InstanceType<typeof import('../../src/storage/node-sqlite.js').NodeSqliteAdapter>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-db-'));
    const { DatabaseSync } = await import('node:sqlite');
    const { NodeSqliteAdapter } = await import('../../src/storage/node-sqlite.js');
    const raw = new DatabaseSync(join(tempDir, 'test.db'));
    adapter = new NodeSqliteAdapter(raw);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exec creates table', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    const result = adapter.all<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table"',
    );
    expect(result.some((r) => r.name === 'test')).toBe(true);
  });

  it('run inserts and returns changes', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    const result = adapter.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1);
  });

  it('get returns single row', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['hello']);
    const row = adapter.get<{ val: string }>('SELECT val FROM test WHERE id = ?', [1]);
    expect(row?.val).toBe('hello');
  });

  it('get returns undefined for no match', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    const row = adapter.get('SELECT * FROM test WHERE id = ?', [999]);
    expect(row).toBeUndefined();
  });

  it('all returns multiple rows', () => {
    adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    adapter.run('INSERT INTO test (val) VALUES (?)', ['a']);
    adapter.run('INSERT INTO test (val) VALUES (?)', ['b']);
    const rows = adapter.all<{ val: string }>('SELECT val FROM test ORDER BY id');
    expect(rows).toEqual([{ val: 'a' }, { val: 'b' }]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage/node-sqlite.test.ts`
Expected: FAIL (stub methods)

**Step 3: Implement NodeSqliteAdapter**

Implement in `src/storage/node-sqlite.ts`:
- Constructor takes `DatabaseSync` instance
- `exec(sql)` -> `this.db.exec(sql)`
- `run(sql, params)` -> use `this.db.prepare(sql).run(...params)`, extract `changes` and `lastInsertRowid`
- `get(sql, params)` -> `this.db.prepare(sql).get(...params)`
- `all(sql, params)` -> `this.db.prepare(sql).all(...params)`
- `close()` -> `this.db.close()`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage/node-sqlite.test.ts`
Expected: PASS (or skipped if Node <22)

**Step 5: Commit**

```bash
git add src/storage/node-sqlite.ts tests/storage/node-sqlite.test.ts
git commit -m "feat: implement NodeSqliteAdapter wrapping node:sqlite"
```

---

### Task 12: SqlJsAdapter

**Files:**
- Modify: `src/storage/sql-js.ts`
- Create: `tests/storage/sql-js.test.ts`

**Context:** Wraps sql.js (WASM SQLite). Includes debounced save to disk (5s) and shutdown handlers. sql.js is an optional dependency.

**Step 1: Write the failing tests**

Tests mirror NodeSqliteAdapter but using sql.js. Skip if sql.js not installed. Additionally test:
- Data persists after save+reload
- Debounced save triggers on timer

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage/sql-js.test.ts`
Expected: FAIL

**Step 3: Implement SqlJsAdapter**

Implement in `src/storage/sql-js.ts`:
- Constructor takes `SQL.Database` instance + `dbPath`
- `exec(sql)` -> `this.db.exec(sql)`
- `run(sql, params)` -> `this.db.run(sql, params)`, return `{ changes: db.getRowsModified(), lastInsertRowid }`
- `get(sql, params)` -> prepare statement, step once, return row or undefined
- `all(sql, params)` -> prepare statement, collect all rows
- `close()` -> save to disk, close db
- `_save()` -> write `db.export()` Uint8Array to disk
- `_scheduleSave()` -> debounce 5s timer, call on every mutation (run, exec)

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage/sql-js.test.ts`
Expected: PASS (or skipped if sql.js not installed)

**Step 5: Commit**

```bash
git add src/storage/sql-js.ts tests/storage/sql-js.test.ts
git commit -m "feat: implement SqlJsAdapter with debounced persistence"
```

---

### Task 13: Database migrations

**Files:**
- Modify: `src/storage/migrations.ts`
- Create: `tests/storage/migrations.test.ts`

**Context:** Create all tables needed by Locus. Version-stamped migrations so schema can evolve.

**Step 1: Write the failing tests**

Test that after `runMigrations(db, fts5)`:
- `schema_version` table exists with version = 1
- `files` table exists with expected columns
- `memories` table exists
- `hook_captures` table exists
- `scan_state` table exists
- If fts5=true, `memories_fts` virtual table exists
- Running twice is idempotent (no errors)

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage/migrations.test.ts`
Expected: FAIL

**Step 3: Implement migrations**

Implement in `src/storage/migrations.ts`:
- `runMigrations(db: DatabaseAdapter, fts5: boolean): void`
- Check current schema version (0 if table doesn't exist)
- Migration v1: create all tables
  - `schema_version (version INTEGER)`
  - `files (relative_path TEXT PK, exports_json TEXT, imports_json TEXT, re_exports_json TEXT, file_type TEXT, language TEXT, lines INTEGER, confidence_level TEXT, confidence_reason TEXT, last_scanned INTEGER, skipped_reason TEXT)`
  - `memories (id INTEGER PK AUTOINCREMENT, layer TEXT, content TEXT, tags_json TEXT, created_at INTEGER, updated_at INTEGER, session_id TEXT)`
  - `hook_captures (id INTEGER PK AUTOINCREMENT, tool_name TEXT, file_paths_json TEXT, status TEXT, exit_code INTEGER, timestamp INTEGER, duration_ms INTEGER, diff_added INTEGER, diff_removed INTEGER, error_kind TEXT, bash_command TEXT)`
  - `scan_state (key TEXT PK, value TEXT)`
  - If fts5: `CREATE VIRTUAL TABLE memories_fts USING fts5(content, content=memories, content_rowid=id)`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage/migrations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/migrations.ts tests/storage/migrations.test.ts
git commit -m "feat: implement database migrations with schema versioning"
```

---

### Task 14: initStorage + detectFts5

**Files:**
- Modify: `src/storage/init.ts`
- Create: `tests/storage/init.test.ts`

**Context:** Contract 5 -- runtime detection of node:sqlite vs sql.js, then FTS5 availability. Returns `{ db, backend, fts5 }`.

**Step 1: Write the failing tests**

Test that `initStorage(dbPath)` returns a working adapter regardless of Node version. Test `detectFts5()` separately.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/storage/init.test.ts`
Expected: FAIL

**Step 3: Implement initStorage**

Per ARCHITECTURE.md "Detection logic at startup":
1. Try `import('node:sqlite')`, create DatabaseSync, wrap in NodeSqliteAdapter
2. Catch -> try `import('sql.js')`, init, wrap in SqlJsAdapter
3. Run `detectFts5(db)` -- CREATE/DROP fts5 test table
4. Run `runMigrations(db, fts5)`
5. Return `{ db, backend, fts5 }`

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/storage/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/init.ts tests/storage/init.test.ts
git commit -m "feat: implement storage initialization with node:sqlite/sql.js fallback"
```

---

### Task 15: Scanner orchestrator -- chooseScanStrategy

**Files:**
- Modify: `src/scanner/index.ts`
- Create: `tests/scanner/strategy.test.ts`

**Context:** Contract 6 -- decide between git-diff, mtime, and full rescan based on thresholds, cooldowns, and project state.

**Step 1: Write the failing tests**

Test all paths from Contract 6:
- Debounce (too soon since last scan -> skip)
- Git: same HEAD, no changes -> skip
- Git: same HEAD, unstaged changes -> git-diff with changed files
- Git: fast-forward -> git-diff between commits
- Git: branch switch (not ancestor) -> fall to mtime
- mtime: few changes -> mtime scan
- mtime: many changes (>30% or >200) -> full rescan
- No git -> mtime always
- Cooldown prevents repeated full rescans

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scanner/strategy.test.ts`
Expected: FAIL

**Step 3: Implement chooseScanStrategy**

Implement the decision tree from ARCHITECTURE.md Contract 6 in `src/scanner/index.ts`. Helper functions:
- `isGitRepo(path)` -- check for `.git` directory existence
- `getGitHead(path)` -- run `git rev-parse HEAD` via execFileSync
- `gitDiffFiles(path)` -- run `git diff --name-only` via execFileSync
- `gitDiffBetween(from, to, path)` -- run `git diff --name-only from..to`
- `isAncestor(older, newer, path)` -- `git merge-base --is-ancestor`
- `findFilesByMtime(path, since)` -- walk directory + stat for mtime comparison

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/strategy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/index.ts tests/scanner/strategy.test.ts
git commit -m "feat: implement scan strategy selection (Contract 6)"
```

---

### Task 16: Scanner orchestrator -- scanProject

**Files:**
- Modify: `src/scanner/index.ts`
- Create: `tests/scanner/scan-project.test.ts`
- Create: `tests/fixtures/sample-project/` (small fixture)

**Context:** The main scan function. Walks files, applies ignore rules, reads each file, strips non-code, parses exports/imports, computes confidence, stores to DB.

**Step 1: Create test fixture**

Create `tests/fixtures/sample-project/` with:
- `package.json` (simple: name, dependencies)
- `tsconfig.json` (with `@/*` alias pointing to `./src/*`)
- `src/index.ts` (barrel: `export * from './auth/login'`)
- `src/auth/login.ts` (exports loginUser function, imports from prisma)
- `src/utils/helpers.ts` (exports formatDate const)
- `.env` (should be ignored/denylisted)
- `node_modules/.keep` (should be ignored)

**Step 2: Write the failing tests**

Test that `scanProject(fixturePath, db, config)` returns correct ScanResult:
- Correct file count (3 scanned TS files, 2 ignored: .env + node_modules)
- Correct exports parsed for each file
- Correct imports parsed
- Barrel file detected with medium:barrel confidence
- ScanStats populated correctly

**Step 3: Implement scanProject**

1. `chooseScanStrategy()` to determine which files
2. Walk directory (recursive readdir) or use strategy's file list
3. For each file: `shouldIgnore()`, `isDenylisted()`, check size (config.maxFileSize), binary check (null bytes in first 8KB)
4. Detect language from extension (.ts/.js/.tsx/.jsx -> typescript, .py -> python)
5. Read file, check for generated header in first 5 lines
6. `stripNonCode()` (for TS/JS only)
7. Parse based on language (parseExports/parseImports/parseReExports or parsePython*)
8. Load path aliases from tsconfig, `resolveAlias()` for each import
9. `computeConfidence()`
10. Build FileEntry, store to DB via INSERT/REPLACE
11. Collect ScanStats, return ScanResult

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scanner/scan-project.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scanner/index.ts tests/scanner/scan-project.test.ts tests/fixtures/
git commit -m "feat: implement scanProject with file walking and parsing"
```

---

### Task 17: SemanticMemory

**Files:**
- Modify: `src/memory/semantic.ts`
- Create: `tests/memory/semantic.test.ts`

**Context:** Layer 2 memory. CRUD operations for decisions/context. Stored in `memories` table with `layer='semantic'`. Search via FTS5 or LIKE fallback.

**Step 1: Write the failing tests**

Test add, search (by query), remove, list, tag filtering. Use real DB adapter (NodeSqlite or sql.js).

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/memory/semantic.test.ts`
Expected: FAIL

**Step 3: Implement SemanticMemory**

- Constructor takes `DatabaseAdapter` + `fts5Available: boolean`
- `add(content, tags)` -- INSERT into memories with layer='semantic', update FTS5 index if available
- `search(query, limit)` -- FTS5 MATCH if available, else LIKE '%query%' fallback
- `remove(id)` -- DELETE from memories where id=? and layer='semantic', update FTS5
- `list(limit)` -- SELECT all semantic entries, ordered by updated_at DESC
- `count()` -- SELECT COUNT(*) from memories where layer='semantic'

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory/semantic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/semantic.ts tests/memory/semantic.test.ts
git commit -m "feat: implement SemanticMemory with FTS5 search"
```

---

### Task 18: EpisodicMemory

**Files:**
- Modify: `src/memory/episodic.ts`
- Create: `tests/memory/episodic.test.ts`

**Context:** Layer 3 memory. Session event history. Stored in `memories` table with `layer='episodic'`.

**Step 1: Write the failing tests**

Test addEvent, getRecent (last N sessions), getBufferTokens.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/memory/episodic.test.ts`
Expected: FAIL

**Step 3: Implement EpisodicMemory**

- Constructor takes `DatabaseAdapter`
- `addEvent(content, sessionId)` -- INSERT with layer='episodic', session_id
- `getRecent(limit)` -- SELECT last N distinct sessions with their entries
- `getBufferTokens()` -- estimate total uncompressed token count via estimateTokens()
- `count()` -- total episodic entries
- `sessionCount()` -- COUNT DISTINCT session_id

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory/episodic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/episodic.ts tests/memory/episodic.test.ts
git commit -m "feat: implement EpisodicMemory with session tracking"
```

---

### Task 19: MemoryCompressor

**Files:**
- Modify: `src/memory/compressor.ts`
- Create: `tests/memory/compressor.test.ts`

**Context:** Compression engine. For MVP: simple concatenation + truncation. LLM-based compression is v2.

**Step 1: Write the failing tests**

Test `shouldCompress(bufferTokens)` returns true when over threshold. Test `compress(entries)` produces a shorter summary.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/memory/compressor.test.ts`
Expected: FAIL

**Step 3: Implement MemoryCompressor**

- Constructor takes `LocusConfig`
- `shouldCompress(bufferTokens)` -- `bufferTokens > config.compressionThreshold`
- `compress(entries)` -- for MVP: take last N entries that fit within threshold/2 tokens, concatenate with session headers, discard oldest

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/memory/compressor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/compressor.ts tests/memory/compressor.test.ts
git commit -m "feat: implement MemoryCompressor with threshold-based triggering"
```

---

### Task 20: Project root resolution

**Files:**
- Create: `src/project-root.ts`
- Create: `tests/project-root.test.ts`

**Context:** Contract 7 -- resolve project root via git root > highest project marker > cwd fallback.

**Step 1: Write the failing tests**

Test git root detection (using actual git repo in temp dir), marker walking (highest wins), cwd fallback (no markers).

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/project-root.test.ts`
Expected: FAIL

**Step 3: Implement resolveProjectRoot**

Per Contract 7 in `src/project-root.ts`:
- `tryGitRoot(cwd)` -- execFileSync `git rev-parse --show-toplevel`, catch errors
- Walk up directories checking for PROJECT_MARKERS (12 markers from architecture)
- Keep highest marker directory (not nearest)
- Fallback to cwd
- Return `{ root, method }` with ProjectRootMethod type

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/project-root.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/project-root.ts tests/project-root.test.ts
git commit -m "feat: implement project root resolution (Contract 7)"
```

---

### Task 21: MCP Resource -- project-map

**Files:**
- Modify: `src/resources/project-map.ts`
- Create: `tests/resources/project-map.test.ts`

**Context:** Contract 8 -- generate compact project tree (<2000 tokens). 2-level nesting, file counts, stack summary.

**Step 1: Write the failing tests**

Test tree formatting rules from Contract 8:
- Max 2 levels deep
- <=8 files: list names; >8: count only
- >20 dirs: top 15 + "N more"
- Token budget enforcement (estimateTokens < 2000)
- Progressive detail reduction when over budget

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/resources/project-map.test.ts`
Expected: FAIL

**Step 3: Implement generateProjectMap**

Implement in `src/resources/project-map.ts`:
- Takes DB adapter, reads files table
- Build directory tree from file paths
- Format per Contract 8 rules
- Enforce token budget with progressive reduction

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/resources/project-map.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/resources/project-map.ts tests/resources/project-map.test.ts
git commit -m "feat: implement project-map MCP resource (Contract 8)"
```

---

### Task 22: MCP Resource -- decisions

**Files:**
- Modify: `src/resources/decisions.ts`
- Create: `tests/resources/decisions.test.ts`

**Context:** Contract 8 -- bullet list of semantic memories, <500 tokens, max 15 entries, most recent first.

**Step 1-5: TDD flow**

Test formatting: bullet list, 100-char max per entry, 15 entry limit, token budget, "N older" message.

```bash
git commit -m "feat: implement decisions MCP resource (Contract 8)"
```

---

### Task 23: MCP Resource -- recent

**Files:**
- Modify: `src/resources/recent.ts`
- Create: `tests/resources/recent.test.ts`

**Context:** Contract 8 -- last 3-5 session summaries, <1000 tokens. Session N (time): summary + files.

**Step 1-5: TDD flow**

Test formatting: session display, file list (max 5 + "N more"), token budget, "No sessions" message.

```bash
git commit -m "feat: implement recent episodes MCP resource (Contract 8)"
```

---

### Task 24: Tool handlers -- explore + search

**Files:**
- Modify: `src/tools/explore.ts`, `src/tools/search.ts`
- Create: `tests/tools/explore.test.ts`, `tests/tools/search.test.ts`

**Context:** `memory_explore(path)` returns file details for a directory from DB. `memory_search(query)` searches across all 3 layers (structural files, semantic memories, episodic entries).

**Step 1: Write the failing tests**

Test explore: returns files in specified directory with exports/imports/confidence. Test search: returns results from all 3 layers, sorted by relevance.

**Step 2-5: TDD flow**

```bash
git commit -m "feat: implement explore and search tool handlers"
```

---

### Task 25: Tool handlers -- remember + forget

**Files:**
- Modify: `src/tools/remember.ts`, `src/tools/forget.ts`
- Create: `tests/tools/remember.test.ts`, `tests/tools/forget.test.ts`

**Context:** `memory_remember(text, tags)` stores via SemanticMemory after redaction. `memory_forget(query)` deletes matches; if >5 matches, requires confirmation token (reuse Contract 9 pattern from purge).

**Step 1-5: TDD flow**

```bash
git commit -m "feat: implement remember and forget tool handlers"
```

---

### Task 26: Tool handlers -- scan + status

**Files:**
- Modify: `src/tools/scan.ts`, `src/tools/status.ts`
- Create: `tests/tools/scan.test.ts`, `tests/tools/status.test.ts`

**Context:** `memory_scan()` triggers scanProject and returns ScanResult summary. `memory_status()` queries DB for MemoryStatus fields (file counts, memory counts, DB size, backend info).

**Step 1-5: TDD flow**

```bash
git commit -m "feat: implement scan and status tool handlers"
```

---

### Task 27: Tool handlers -- doctor + audit

**Files:**
- Modify: `src/tools/doctor.ts`, `src/tools/audit.ts`
- Create: `tests/tools/doctor.test.ts`, `tests/tools/audit.test.ts`

**Context:** `memory_doctor()` runs 10 checks per ARCHITECTURE.md (Node version, storage backend, FTS5, DB writable, project root, git, capture level, disk space, log writable, scanner state). `memory_audit()` returns data summary per audit format.

**Step 1-5: TDD flow**

```bash
git commit -m "feat: implement doctor and audit tool handlers"
```

---

### Task 28: Tool handler -- purge

**Files:**
- Modify: `src/tools/purge.ts`
- Create: `tests/tools/purge.test.ts`

**Context:** Contract 9 -- two-call confirmation pattern. First call returns token + stats, second call with valid token deletes DB. Token expires after 60s, single-use.

**Step 1: Write the failing tests**

```typescript
// tests/tools/purge.test.ts
import { describe, expect, it } from 'vitest';

describe('handlePurge', () => {
  it('first call without token returns pending_confirmation with stats', async () => {
    // Setup: create purge handler with mock DB
    // Call handlePurge(undefined)
    // Expect: { status: 'pending_confirmation', confirmToken: /^purge-[0-9a-f]{8}$/, stats, message }
  });

  it('second call with valid token purges and returns done', async () => {
    // First call to get token, then second call with that token
    // Expect: { status: 'purged', deletedDbPath, message }
  });

  it('rejects invalid token', async () => {
    // Call with random string
    // Expect: { status: 'error', message: contains 'invalid' }
  });

  it('rejects reused token', async () => {
    // Get token, use it successfully, try again
    // Expect: { status: 'error' }
  });

  it('token format is purge- + 8 hex chars', async () => {
    // Check format
  });
});
```

**Step 2-5: TDD flow**

```bash
git commit -m "feat: implement purge with two-call confirmation (Contract 9)"
```

---

### Task 29: post-tool-use hook

**Files:**
- Modify: `hooks/post-tool-use.js`
- Create: `tests/hooks/post-tool-use.test.ts`

**Context:** Contract 1 -- captures metadata from tool invocations. Extracts fields per capture level. Plain JS (hooks are loaded outside TS build pipeline by Claude Code).

**Step 1: Write the failing tests**

Test metadata extraction at each captureLevel:
- metadata: only toolName, filePaths, status, timestamp, durationMs, exitCode, diffStats
- redacted: adds errorKind, bashCommand (first token only)
- full: adds everything

Test that "metadata" level never includes content fields. Test error classification (ErrorKind).

**Step 2-5: TDD flow**

```bash
git commit -m "feat: implement post-tool-use hook with capture levels (Contract 1)"
```

---

### Task 30: Server integration -- wire everything together

**Files:**
- Modify: `src/server.ts`
- Create: `tests/integration/server.test.ts`

**Context:** Connect all tool handlers and resource generators to actual storage, scanner, and memory instances. Currently server.ts registers all tools/resources but calls stub handlers.

**Step 1: Write integration tests**

Test that server can be instantiated, tools return valid responses (not "Not implemented"), resources return formatted strings.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/server.test.ts`
Expected: FAIL

**Step 3: Implement server wiring**

1. At startup: `resolveProjectRoot(process.cwd())` -> `projectHash()` -> construct dbPath
2. `initStorage(dbPath)` -> `{ db, backend, fts5 }`
3. Create instances: `SemanticMemory(db, fts5)`, `EpisodicMemory(db)`, `MemoryCompressor(config)`
4. Run initial scan if no previous scan state in DB
5. Wire each tool handler: pass dependencies (db, memories, scanner, config)
6. Wire each resource generator: pass dependencies
7. Log startup info: storage backend, FTS5 status, DB path, file count
8. Startup warning for non-metadata capture levels

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server.ts tests/integration/server.test.ts
git commit -m "feat: wire server.ts with all dependencies and handlers"
```

---

### Task 31: End-to-end tests

**Files:**
- Create: `tests/integration/e2e.test.ts`

**Context:** Full lifecycle test using fixture project:
1. Scan fixture project -> verify file entries in DB
2. Search structural layer -> find exports
3. Remember a decision -> verify in semantic memory
4. Search semantic layer -> find the decision
5. Check resources (project-map, decisions, recent) -> verify token budgets
6. Forget the decision -> verify deletion
7. Purge -> verify clean state

**Step 1: Write e2e tests**

**Step 2: Run and verify they pass** (all dependencies should work by now)

**Step 3: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: add end-to-end integration tests"
```

---

### Task 32: Final verification + tag

**Step 1: Run full check**

```bash
npm run check    # typecheck + lint + all tests
npm run build    # esbuild bundle
```

**Step 2: Verify test count**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`
Target: 200+ test cases across all suites.

**Step 3: Verify bundle**

Check `dist/server.js` exists, reasonable size (<2MB).

**Step 4: Tag release**

```bash
git tag -a v0.1.0 -m "Locus v0.1.0 - MVP implementation"
```

---

## Task Summary Table

| # | Module | Layer | Dependencies | Est. Tests |
|---|--------|-------|--------------|------------|
| 1 | Logger | 0 | none | 5 |
| 2 | Redact | 0 | none | 15 |
| 3 | File denylist | 0 | none | 8 |
| 4 | stripNonCode | 0 | none | 20 |
| 5 | TS parser | 2 | strip | 20 |
| 6 | Python parser | 2 | strip | 10 |
| 7 | Config parser | 2 | none | 8 |
| 8 | Path aliases | 2 | config parser | 6 |
| 9 | Ignore rules | 2 | none | 10 |
| 10 | Confidence | 2 | types | 8 |
| 11 | NodeSqliteAdapter | 1 | none | 6 |
| 12 | SqlJsAdapter | 1 | none | 6 |
| 13 | Migrations | 1 | adapter | 6 |
| 14 | initStorage | 1 | adapters+migrations | 4 |
| 15 | Scan strategy | 3 | git helpers | 10 |
| 16 | scanProject | 3 | all scanner+storage | 8 |
| 17 | SemanticMemory | 4 | storage | 8 |
| 18 | EpisodicMemory | 4 | storage | 6 |
| 19 | Compressor | 4 | config | 4 |
| 20 | Project root | 0 | none | 8 |
| 21 | Resource: project-map | 5 | storage+scanner | 6 |
| 22 | Resource: decisions | 5 | semantic memory | 4 |
| 23 | Resource: recent | 5 | episodic memory | 4 |
| 24 | Tools: explore+search | 6 | storage+memory | 8 |
| 25 | Tools: remember+forget | 6 | semantic+redact | 8 |
| 26 | Tools: scan+status | 6 | scanner+storage | 6 |
| 27 | Tools: doctor+audit | 6 | storage+config | 8 |
| 28 | Tool: purge | 6 | storage (Contract 9) | 6 |
| 29 | Hook | 7 | security+storage | 10 |
| 30 | Server wiring | 8 | everything | 6 |
| 31 | E2E tests | 8 | everything | 8 |
| 32 | Final verification | - | - | 0 |
| | **Total** | | | **~237** |

## Parallelization Opportunities

Tasks within the same layer can be parallelized by separate agents:

- **Layer 0** (Tasks 1-4, 20): All independent, run all 5 in parallel
- **Layer 1** (Tasks 11-14): 11 and 12 in parallel, then 13, then 14
- **Layer 2** (Tasks 5-10): All 6 independent after Layer 0, run in parallel
- **Layer 4** (Tasks 17-19): All 3 independent after Layer 1, run in parallel
- **Layer 5** (Tasks 21-23): All 3 independent, run in parallel
- **Layer 6** (Tasks 24-28): 24+25+26+27+28 are mostly independent, run in parallel
