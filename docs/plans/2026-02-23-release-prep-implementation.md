# Release Prep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create LICENSE, hooks/hooks.json, update plugin.json, update package.json, and write a full README.md so Locus can be installed as a Claude Code plugin and published to npm.

**Architecture:** Five independent files — no code logic changes, only metadata and documentation. TDD is not applicable (no testable code). Each task is one file, committed separately.

**Tech Stack:** Markdown, JSON, plain text

---

### Task 1: Create LICENSE

**Files:**
- Create: `LICENSE`

**Step 1: Create the MIT license file**

```text
MIT License

Copyright (c) 2026 Magnifico4625

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Verify lint passes**

Run: `npx biome check LICENSE`
Expected: Biome ignores non-code files — no errors.

**Step 3: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 2: Create hooks/hooks.json

**Files:**
- Create: `hooks/hooks.json`

**Step 1: Create the hooks manifest**

This tells Claude Code *when* to invoke `hooks/post-tool-use.js`.
The matcher covers all file-touching tools that Locus should capture.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Write|Edit|Bash|Glob|Grep|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: add hooks.json manifest for PostToolUse auto-registration"
```

---

### Task 3: Update .claude-plugin/plugin.json

**Files:**
- Modify: `.claude-plugin/plugin.json`

**Step 1: Replace the current plugin.json content**

Current file has empty author/homepage/repository and no component paths.
Replace with the full manifest from the design doc:

```json
{
  "name": "locus",
  "version": "0.1.0",
  "description": "Persistent project-aware memory for Claude Code. Structural map, decisions, session history — zero native deps.",
  "author": {
    "name": "Magnifico4625",
    "email": "vozol81@mail.ru"
  },
  "repository": "https://github.com/Magnifico4625/locus",
  "homepage": "https://github.com/Magnifico4625/locus",
  "license": "MIT",
  "keywords": ["memory", "mcp", "codebase", "context", "ai-agent"],
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json"
}
```

**Step 2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: complete plugin.json manifest with author, repo, hooks"
```

---

### Task 4: Update package.json

**Files:**
- Modify: `package.json`

**Step 1: Add author object and repository/homepage fields**

Update `"author"` from empty string `""` to:
```json
"author": {
  "name": "Magnifico4625",
  "email": "vozol81@mail.ru",
  "url": "https://github.com/Magnifico4625"
}
```

Add after `"license"` line:
```json
"homepage": "https://github.com/Magnifico4625/locus",
"repository": {
  "type": "git",
  "url": "https://github.com/Magnifico4625/locus.git"
},
"bugs": {
  "url": "https://github.com/Magnifico4625/locus/issues"
}
```

**Step 2: Verify package.json is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"`
Expected: `valid`

**Step 3: Run full check to ensure nothing broke**

Run: `npm run check`
Expected: typecheck + lint + 485 tests pass

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add author, repository, homepage to package.json"
```

---

### Task 5: Create README.md

**Files:**
- Create: `README.md`

This is the largest task. The README should be comprehensive but scannable.
Write it section by section following the structure from the design doc.

**Step 1: Write README.md**

The README must include these sections in order:

1. **Header block** — `# Locus`, tagline, badges row:
   - `npm version` badge
   - `node >= 22` badge
   - `license MIT` badge
   - `tests 485 passed` badge

2. **What is Locus?** (~150 words)
   - Problem: context lost between Claude Code sessions
   - Solution: 3-layer persistent memory (structural + semantic + episodic)
   - Locus complements CLAUDE.md — not a replacement
   - Zero native deps, metadata-only by default

3. **Features** — bullet list:
   - 3 memory layers
   - 9 MCP tools (on-demand)
   - 3 auto-injected resources (<3.5k tokens)
   - Incremental scanning (git-diff → mtime → full)
   - 4-layer security (metadata-only → denylist → redaction → audit)
   - Zero native dependencies (Node 22+ built-in sqlite, sql.js fallback)
   - Cross-platform (Windows, macOS, Linux)

4. **Quick Start** (~100 words)
   - Prerequisites: Node.js >= 22, Claude Code
   - Install: `claude plugin install locus` (or --plugin-dir for dev)
   - First scan: use `memory_scan` tool or `/memory-status`

5. **Tools Reference** — table with 9 tools:

   | Tool | Parameters | Description |
   |------|-----------|-------------|
   | `memory_explore` | `path: string` | Navigate project structure |
   | `memory_search` | `query: string` | Full-text search across all 3 layers |
   | `memory_remember` | `text: string, tags?: string[]` | Store a decision (auto-redacted) |
   | `memory_forget` | `query: string, confirmToken?: string` | Delete matching memories (bulk safety) |
   | `memory_scan` | — | Scan project, index code structure |
   | `memory_status` | — | Runtime stats, config, DB info |
   | `memory_doctor` | — | 10-point health check |
   | `memory_audit` | — | Data inventory and security audit |
   | `memory_purge` | `confirmToken?: string` | Clear all project memory (two-step) |

6. **Resources** — table with 3 resources:

   | URI | Description | Budget |
   |-----|-------------|--------|
   | `memory://project-map` | File tree, exports, imports, confidence | <2k tokens |
   | `memory://decisions` | Recent semantic memories (up to 15) | <500 tokens |
   | `memory://recent` | Session activity log (up to 5 sessions) | <1k tokens |

7. **Configuration** — table of defaults + env vars:
   - `LOCUS_LOG` env var
   - `LOCUS_CAPTURE_LEVEL` env var (planned)
   - Default config values from types.ts

8. **Security** (~80 words)
   - Layer 1: Metadata-only (no raw content by default)
   - Layer 2: File denylist (.env, *.key, credentials)
   - Layer 3: Content redaction (passwords, API keys, tokens)
   - Layer 4: Audit UX (memory_audit tool)

9. **Architecture** (~100 words)
   - Text diagram showing 3 memory layers
   - Scanner strategies (git-diff / mtime / full)
   - Storage: node:sqlite primary, sql.js fallback
   - Hook: PostToolUse captures metadata independently

10. **Development** — commands:
    ```
    git clone https://github.com/Magnifico4625/locus.git
    cd locus
    npm install
    npm test          # 485 tests
    npm run typecheck  # TypeScript
    npm run lint       # Biome
    npm run build      # Bundle to dist/server.js
    ```

11. **License** — one line: `MIT — see [LICENSE](LICENSE)`

**Step 2: Verify lint passes**

Run: `npx biome check README.md`
Expected: Biome ignores .md files — no errors.

**Step 3: Rebuild to verify nothing broke**

Run: `npm run check`
Expected: typecheck + lint + 485 tests pass.

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with tools reference and quick start"
```

---

### Task 6: Final verification and branch merge

**Step 1: Run full project check**

Run: `npm run check`
Expected: All pass (typecheck + lint + 485 tests)

**Step 2: Verify all new files exist**

Run: `ls LICENSE README.md hooks/hooks.json .claude-plugin/plugin.json`
Expected: All 4 files listed.

**Step 3: Verify git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

**Step 4: Merge branch to master** (if on feature branch)

```bash
git checkout master
git merge --no-ff release/prep-v0.1.0 -m "Merge release/prep-v0.1.0: add LICENSE, README, plugin manifest"
```
