# Track B One-Command Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Locus installable into Codex CLI with one command through a publishable `locus-memory` npm package, while keeping marketplace packaging thin and manual MCP setup supported.

**Current status:** Track B implementation and npm/local post-publish validation are complete as of 2026-04-28. `locus-memory@3.5.0` is published to npm, one-command install is validated from the registry in a disposable `CODEX_HOME`, and the local Codex config has been migrated to the published package runtime. `v3.5.1` adds safe MCP `cwd = "$CODEX_HOME"` startup behavior; `v3.5.2` fixes `doctor codex` ownership detection for the real `codex mcp get locus` path. Final GitHub push/release publication remains the next release-management step.

**Architecture:** Add a dedicated `packages/cli` package for user-facing commands and install orchestration. Keep `packages/core` as the MCP runtime and `packages/codex` as the Codex adapter asset/helper package. The root package becomes the public `locus-memory` package and publishes built runtime assets plus the CLI entrypoint; marketplace output is generated into `dist/marketplace/` and deployed separately.

**Tech Stack:** Node.js >=22, TypeScript, esbuild, Vitest, npm workspaces, Codex CLI `0.124.0`, Codex MCP config, Codex plugin marketplace JSON.

---

## Source Documents

- Design spec: `docs/superpowers/specs/2026-04-24-track-b-one-command-install-design.md`
- Roadmap: `docs/roadmap/codex-next.md`
- Existing Codex adapter: `packages/codex/`
- Existing local plugin bundle: `plugins/locus-memory/`
- Existing repo marketplace: `.agents/plugins/marketplace.json`

## Scope

In scope:

- publishable package shape for `locus-memory`
- `locus-memory` CLI commands:
  - `mcp`
  - `install codex`
  - `doctor codex`
  - `uninstall codex`
- Codex installer with `redacted` defaults
- idempotency, backup, and ownership behavior
- install lock / race-condition protection
- interrupted install cleanup
- version-pinned runtime MCP command
- npm cache/network resilience checks for the pinned runtime command
- skill install into `$CODEX_HOME/skills/locus-memory/SKILL.md`
- generated marketplace bundle in `dist/marketplace/`
- package tarball and Codex install acceptance checks
- docs and roadmap truth updates

Out of scope:

- richer recall ranking
- dashboard UI
- official OpenAI marketplace inclusion as a hard dependency
- secondary IDE adapters
- Claude Code behavior changes
- automatic mutation of a second marketplace repository by a local npm script

## File Structure

Create:

- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/mcp.ts`
- `packages/cli/src/commands/install-codex.ts`
- `packages/cli/src/commands/doctor-codex.ts`
- `packages/cli/src/commands/uninstall-codex.ts`
- `packages/cli/src/codex/config.ts`
- `packages/cli/src/codex/paths.ts`
- `packages/cli/src/codex/skill.ts`
- `packages/cli/src/codex/commands.ts`
- `packages/cli/src/codex/lock.ts`
- `packages/cli/src/codex/cleanup.ts`
- `packages/cli/src/codex/report.ts`
- `packages/cli/src/version-consistency.ts`
- `packages/cli/src/package-info.ts`
- `packages/cli/tests/cli.test.ts`
- `packages/cli/tests/codex-config.test.ts`
- `packages/cli/tests/codex-install.test.ts`
- `packages/cli/tests/codex-doctor.test.ts`
- `packages/cli/tests/codex-uninstall.test.ts`
- `packages/cli/tests/codex-lock.test.ts`
- `packages/cli/tests/codex-cleanup.test.ts`
- `packages/cli/tests/version-consistency.test.ts`
- `packages/cli/tests/package-info.test.ts`
- `scripts/sync-codex-marketplace.mjs`
- `packages/codex/tests/marketplace-bundle.test.ts`
- `packages/codex/tests/package-contract.test.ts`
- `packages/codex/tests/post-publish-validation.test.ts`
- `docs/releases/v3.5.0.md`

Modify:

- `package.json`
- `package-lock.json`
- `esbuild.config.ts`
- `packages/codex/src/skill-sync.ts`
- `packages/codex/src/plugin-sync.ts`
- `packages/codex/src/index.ts`
- `packages/codex/package.json`
- `packages/codex/README.md`
- `packages/core/package.json`
- `packages/shared-runtime/package.json`
- `plugins/locus-memory/.mcp.json`
- `plugins/locus-memory/.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json`
- `README.md`
- `docs/codex-vscode-extension.md`
- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`
- `docs/index.html`
- `packages/codex/config/config.toml.example`
- `CHANGELOG.md`

Do not modify:

- `packages/claude-code/**` unless a shared contract test proves a required change
- `packages/core/src/**` except build/export wiring if absolutely required for `mcp`
- memory schema/migrations unless a test proves packaging cannot work otherwise

---

## Task B0: Planning Baseline

**Files:**
- Modify: `docs/superpowers/plans/2026-04-24-track-b-one-command-install.md`

- [x] **Step 1: Verify branch and clean tree**

Run:

```bash
git status --short --branch
git log --oneline --decorate -n 5
```

Expected: branch `docs/track-b-one-command-install`, clean tree after this plan commit is complete, and `v3.4.0` on `main`.

- [x] **Step 2: Confirm source facts**

Run:

```bash
codex --version
codex mcp add --help
codex plugin marketplace add --help
npm view locus-memory name version description --json
```

Expected:

- Codex CLI reports `0.124.0` or newer.
- `codex mcp add` supports repeated `--env`.
- `codex plugin marketplace add` exists.
- `npm view locus-memory` returns `E404` until the package is published.

- [x] **Step 3: Commit the implementation plan**

Run:

```bash
git add docs/superpowers/plans/2026-04-24-track-b-one-command-install.md
git commit -m "docs(codex): plan track b one-command install"
```

Expected: docs-only planning commit.

---

## Task B1: Publishable Package Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `esbuild.config.ts`
- Create: `packages/codex/tests/package-contract.test.ts`

- [x] **Step 1: Write failing package contract tests**

Create `packages/codex/tests/package-contract.test.ts` with tests that assert:

- root `package.json` name is `locus-memory`
- root package is not private
- root package has `bin.locus-memory`
- root package `files` includes `dist/`, `README.md`, and `LICENSE`
- root package `main` points to built MCP runtime
- root package has `prepublishOnly`
- `package-lock.json` root package version matches root `package.json`
- package contract records a maximum expected tarball/runtime size budget for `dist/cli.js` and `dist/server.js`
- root version, workspace versions, plugin manifest version, and package-lock root version are checked early, not only in the release task

Run:

```bash
npm test -- packages/codex/tests/package-contract.test.ts
```

Expected: FAIL because package is still private and has no `bin`.

- [x] **Step 2: Update root package metadata minimally**

Modify `package.json`:

- remove or set `"private": false`
- add:

```json
"bin": {
  "locus-memory": "dist/cli.js"
}
```

- ensure `files` includes:

```json
[
  "dist/",
  "packages/codex/skills/locus-memory/SKILL.md",
  "LICENSE",
  "README.md"
]
```

Do not publish yet.

- [x] **Step 3: Update build output plan**

Modify `esbuild.config.ts` so it builds:

- `packages/core/src/server.ts` to `dist/server.js`
- `packages/cli/src/index.ts` to `dist/cli.js`

Keep the shebang banner for both outputs.

Do not blindly bundle the full MCP server into `dist/cli.js`. The CLI bundle should keep install/doctor/uninstall logic separate and make `locus-memory mcp` locate `dist/server.js` through a stable relative path from `import.meta.url` after build. Add a test or package-contract assertion that catches accidental server duplication in `dist/cli.js` by checking the file is materially smaller than `dist/server.js`.

- [x] **Step 4: Refresh lockfile without scripts**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `package-lock.json` reflects root package publish metadata and new workspace if already added later. If this task runs before `packages/cli` exists, lockfile update may be repeated in Task B2.

- [x] **Step 5: Verify package contract tests**

Run:

```bash
npm test -- packages/codex/tests/package-contract.test.ts
```

Expected: PASS after metadata changes that do not require CLI implementation.

- [x] **Step 6: Add early version consistency test**

Extend `packages/codex/tests/package-contract.test.ts` or add a helper that checks these files agree before any publish-related work continues:

- `package.json`
- `package-lock.json`
- `packages/core/package.json`
- `packages/codex/package.json`
- `packages/shared-runtime/package.json`
- `plugins/locus-memory/.codex-plugin/plugin.json`

Expected: PASS on the current version before Track B version bump, and later PASS again after all versions move to `3.5.0`.

- [x] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json esbuild.config.ts packages/codex/tests/package-contract.test.ts
git commit -m "chore(package): define publishable locus package contract"
```

---

## Task B2: CLI Package Skeleton

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/mcp.ts`
- Create: `packages/cli/src/package-info.ts`
- Create: `packages/cli/tests/cli.test.ts`
- Create: `packages/cli/tests/package-info.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Write failing CLI tests**

Create tests that execute `packages/cli/src/index.ts` through Node/Vitest helpers or import command functions directly.

Required assertions:

- `--help` includes `locus-memory mcp`
- `--help` includes `install codex`
- unknown command exits non-zero with concise usage
- `resolvePackageVersion()` returns root package version
- `resolvePackageVersion()` still returns the root version when called from a nested path under `packages/cli`
- `findPackageRoot()` walks upward from `import.meta.url` or an injected start directory until it finds the root package named `locus-memory`
- `buildRuntimePackageSpecifier()` returns `locus-memory@<version>` and never `@latest`

Run:

```bash
npm test -- packages/cli/tests/cli.test.ts packages/cli/tests/package-info.test.ts
```

Expected: FAIL because package does not exist.

- [x] **Step 2: Add `@locus/cli` workspace**

Create `packages/cli/package.json`:

```json
{
  "name": "@locus/cli",
  "version": "3.5.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@locus/codex": "*",
    "@locus/shared-runtime": "*"
  },
  "devDependencies": {
    "@types/node": "^25.2.3",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

Use the release version selected for Track B. If implementation targets `3.5.0`, all package versions should move together in a later version task.

- [x] **Step 3: Add TypeScript config**

Create `packages/cli/tsconfig.json` aligned with existing package configs:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [x] **Step 4: Implement minimal CLI router**

Create `packages/cli/src/index.ts` with a small router:

- `--help` / `help`
- `mcp`
- `install codex`
- `doctor codex`
- `uninstall codex`

Only `mcp` is allowed to call runtime startup in this task; other commands can return clear "not implemented" until later tasks.

- [x] **Step 5: Implement `mcp` command**

Create `packages/cli/src/commands/mcp.ts` that dynamically imports the built server entrypoint or reuses the existing server module path after build.

If direct import of `packages/core/src/server.ts` is not safe for published runtime, make `dist/cli.js mcp` import `./server.js` after build.

- [x] **Step 6: Implement package info helpers**

Create `packages/cli/src/package-info.ts`:

- `resolvePackageVersion()`
- `findPackageRoot(startDir)`
- `buildRuntimePackageSpecifier(version)`
- `isLatestSpecifier(specifier)`

Tests must enforce pinned version for runtime config.

Do not assume the current working directory is the repository root. The published CLI may run from an npm cache path, a project directory, or a nested workspace. Package version discovery must work from the built CLI location and should have injectable start paths for tests.

- [x] **Step 7: Refresh lockfile**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: `packages/cli` appears as a workspace package.

- [x] **Step 8: Verify CLI tests**

Run:

```bash
npm test -- packages/cli/tests/cli.test.ts packages/cli/tests/package-info.test.ts
npm -w @locus/cli run typecheck
npm run lint
```

Expected: PASS.

- [x] **Step 9: Verify version consistency still passes**

Run:

```bash
npm test -- packages/cli/tests/version-consistency.test.ts packages/codex/tests/package-contract.test.ts
```

Expected: PASS. This catches package/plugin version drift before Task B9.

- [x] **Step 10: Commit**

Run:

```bash
git add packages/cli package.json package-lock.json
git commit -m "feat(cli): add locus command skeleton"
```

---

## Task B3: Codex Install Model And Skill Install

**Files:**
- Create: `packages/cli/src/codex/paths.ts`
- Create: `packages/cli/src/codex/skill.ts`
- Create: `packages/cli/src/codex/lock.ts`
- Create: `packages/cli/src/codex/cleanup.ts`
- Create: `packages/cli/src/codex/report.ts`
- Create: `packages/cli/tests/codex-install.test.ts`
- Create: `packages/cli/tests/codex-lock.test.ts`
- Create: `packages/cli/tests/codex-cleanup.test.ts`
- Modify: `packages/cli/src/commands/install-codex.ts`
- Modify: `packages/codex/src/skill-sync.ts`
- Modify: `packages/codex/src/index.ts`

- [x] **Step 1: Write failing installer model tests**

Tests should cover:

- default Codex home resolves to `~/.codex`
- explicit `CODEX_HOME` is respected
- installer creates `$CODEX_HOME/skills/locus-memory/`
- installer writes `SKILL.md`
- identical skill is `unchanged`
- differing skill is backed up when overwrite is enabled
- backup filename includes timestamp, not only `.bak`
- install result reports `created`, `updated`, `unchanged`, `backed_up`, or `skipped`
- install lock prevents two concurrent installers from mutating the same Codex home
- stale lock files are detected and reported with an actionable message
- interrupted temp files are either cleaned up or ignored safely on the next run
- writes use temp-file-then-rename where direct file writes are needed
- UAC/protected-directory failures return actionable errors instead of partial success

Run:

```bash
npm test -- packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-lock.test.ts packages/cli/tests/codex-cleanup.test.ts
```

Expected: FAIL because installer helpers do not exist.

- [x] **Step 2: Extend reusable skill sync**

Modify `packages/codex/src/skill-sync.ts` to support timestamped backups:

- keep backward compatibility for existing tests where possible
- add option `backupSuffix?: string`
- default new installer behavior should create timestamped backups

Export required helpers from `packages/codex/src/index.ts`.

- [x] **Step 3: Implement Codex path helpers**

Create `packages/cli/src/codex/paths.ts`:

- `resolveCodexHome(env)`
- `resolveCodexConfigPath(env)`
- `resolveCodexSkillPath(env, skillName)`
- tilde expansion
- Windows-safe path handling

Prefer reusing `packages/codex/src/paths.ts` where contracts match.

- [x] **Step 4: Implement skill install helper**

Create `packages/cli/src/codex/skill.ts`:

- read packaged canonical skill
- create target directory
- compare content
- write or skip
- backup differing file when requested
- write through a temporary file followed by rename

- [x] **Step 5: Implement install lock and interrupted cleanup helpers**

Create `packages/cli/src/codex/lock.ts`:

- lock path under `$CODEX_HOME/.locus-install.lock`
- atomic lock create where possible
- stale lock detection with timestamp/process metadata
- explicit release in `finally`

Create `packages/cli/src/codex/cleanup.ts`:

- detects stale `.tmp` files created by Locus installer
- removes safe stale temp files
- never deletes memory databases or non-Locus files

- [x] **Step 6: Implement report model**

Create `packages/cli/src/codex/report.ts` with typed operations:

```ts
export type InstallAction = 'created' | 'updated' | 'unchanged' | 'backed_up' | 'skipped';
```

Return structured results first; format human text at command boundary.

- [x] **Step 7: Wire `install codex --dry-run`**

Modify `packages/cli/src/commands/install-codex.ts` so:

- `--dry-run` reports intended skill path and MCP command
- no file writes happen in dry-run
- default capture mode is `redacted`
- protected directory / permission errors are reported as `permission_denied` and do not claim success

- [x] **Step 8: Verify tests**

Run:

```bash
npm test -- packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-lock.test.ts packages/cli/tests/codex-cleanup.test.ts packages/codex/tests/skill-sync.test.ts
npm -w @locus/cli run typecheck
npm -w @locus/codex run typecheck
```

Expected: PASS.

- [x] **Step 9: Commit**

Run:

```bash
git add packages/cli packages/codex/src/skill-sync.ts packages/codex/src/index.ts packages/codex/tests/skill-sync.test.ts
git commit -m "feat(cli): install codex skill safely"
```

---

## Task B4: Codex MCP Config And Idempotency

**Files:**
- Create: `packages/cli/src/codex/config.ts`
- Create: `packages/cli/src/codex/commands.ts`
- Create: `packages/cli/tests/codex-config.test.ts`
- Modify: `packages/cli/src/commands/install-codex.ts`
- Modify: `packages/cli/src/commands/doctor-codex.ts`
- Modify: `packages/cli/src/commands/uninstall-codex.ts`

- [x] **Step 1: Write failing config tests**

Tests should cover:

- generated MCP command uses `npx` on non-Windows
- generated MCP command uses `npx.cmd` on Windows
- generated args include `-y`, `locus-memory@<installed-version>`, `mcp`
- generated args never include `@latest`
- env defaults include `LOCUS_LOG=error`, `LOCUS_CODEX_CAPTURE=redacted`, `LOCUS_CAPTURE_LEVEL=redacted`
- existing package-owned config is classified as update/unchanged
- existing manual `node /path/to/locus/dist/server.js` config is classified as manual migration needed
- ownership states are explicit:
  - `package-owned`
  - `manual-locus`
  - `foreign-locus`
  - `missing`
- Windows-style dirty paths are rendered safely in any fallback TOML:
  - drive-letter paths such as `C:\Users\Admin\My Project\dist\server.js`
  - paths with spaces
  - paths with backslashes
  - paths with literal double quotes rejected or escaped deliberately
- TOML write path creates backup before direct edit
- `codex mcp add` command builder includes repeated `--env`
- network/cache status is represented in doctor output:
  - pinned package specifier
  - whether the installer attempted to warm npm cache
  - warning that first run after cache cleanup requires network

Run:

```bash
npm test -- packages/cli/tests/codex-config.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement command builders**

Create `packages/cli/src/codex/commands.ts`:

- `buildCodexMcpAddArgs(config)`
- `buildCodexMcpRemoveArgs(name)`
- `detectNpxCommand(platform)`
- no shell string concatenation for executable/args

- [x] **Step 3: Implement config model**

Create `packages/cli/src/codex/config.ts`:

- config classification types
- generated MCP server shape
- minimal TOML block rendering if direct edit fallback is needed
- backup path helper
- ownership classifier

Avoid broad TOML parsing unless needed. Prefer `codex mcp add/remove`.

If fallback TOML rendering is implemented, add a dedicated `quoteTomlBasicString(value)` or equivalent helper and test it with Windows paths that include spaces and backslashes. Do not hand-concatenate unescaped paths into TOML.

- [x] **Step 4: Wire install command**

`locus-memory install codex --yes` should:

- acquire install lock
- run interrupted cleanup before writing
- run `codex mcp add` with pinned package specifier
- warm the pinned npm runtime cache where practical
- install skill
- print structured summary
- release install lock in `finally`
- if a later phase fails after an earlier phase succeeded, report the partial state explicitly and print exact remediation commands instead of pretending the install rolled back completely

For tests, command execution must be injectable/mocked.

- [x] **Step 5: Wire doctor command**

`locus-memory doctor codex` should:

- report Node version
- report Codex availability/version if command runner can execute it
- report Codex home/config/skill paths
- report expected runtime package specifier
- report whether runtime cache warming was attempted or skipped
- report if the current config is package-owned, manual-locus, foreign-locus, or missing
- avoid mutating files

- [x] **Step 6: Wire uninstall command**

`locus-memory uninstall codex --yes` should:

- run `codex mcp remove locus` when owned
- leave memory data untouched
- optionally remove or preserve skill according to plan policy

For first implementation, preserve skill by default and print its path.

- [x] **Step 7: Verify tests**

Run:

```bash
npm test -- packages/cli/tests/codex-config.test.ts packages/cli/tests/codex-install.test.ts packages/cli/tests/codex-doctor.test.ts packages/cli/tests/codex-uninstall.test.ts
npm -w @locus/cli run typecheck
```

Expected: PASS.

- [x] **Step 8: Commit**

Run:

```bash
git add packages/cli
git commit -m "feat(cli): configure codex mcp install flow"
```

---

## Task B5: Marketplace Bundle Generation

**Files:**
- Create: `scripts/sync-codex-marketplace.mjs`
- Create: `packages/codex/tests/marketplace-bundle.test.ts`
- Modify: `package.json`
- Modify: `packages/codex/src/plugin-sync.ts`
- Modify: `packages/codex/src/index.ts`
- Modify: `plugins/locus-memory/.mcp.json`
- Modify: `plugins/locus-memory/.codex-plugin/plugin.json`
- Modify: `.agents/plugins/marketplace.json`

- [x] **Step 1: Write failing marketplace bundle tests**

Tests should assert:

- sync script generates `dist/marketplace/.agents/plugins/marketplace.json`
- generated plugin exists at `dist/marketplace/plugins/locus-memory`
- generated plugin `.mcp.json` uses `npx` or `npx.cmd` policy appropriate for distribution
- generated `.mcp.json` uses `locus-memory@<version>` and never `@latest`
- generated `.mcp.json` uses `redacted` capture defaults
- generated skill equals canonical skill
- script does not require or mutate a second git repository

Run:

```bash
npm test -- packages/codex/tests/marketplace-bundle.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement marketplace sync script**

Create `scripts/sync-codex-marketplace.mjs`:

- reads root package version
- creates `dist/marketplace/`
- writes marketplace JSON
- writes plugin manifest
- writes public `.mcp.json`
- copies canonical skill
- prints output paths

No git commands.

- [x] **Step 3: Add npm script**

Modify root `package.json`:

```json
"sync:codex-marketplace": "node scripts/sync-codex-marketplace.mjs"
```

- [x] **Step 4: Update local plugin expectations carefully**

Keep repo-local `plugins/locus-memory/.mcp.json` local-dev-friendly unless implementation decides to switch it too.

Generated `dist/marketplace/plugins/locus-memory/.mcp.json` must be public-package-friendly.

- [x] **Step 5: Verify marketplace tests**

Run:

```bash
npm test -- packages/codex/tests/plugin-bundle.test.ts packages/codex/tests/marketplace-bundle.test.ts
npm run sync:codex-marketplace
```

Expected: PASS and generated files appear under `dist/marketplace/`.

- [x] **Step 6: Commit**

Run:

```bash
git add scripts/sync-codex-marketplace.mjs package.json packages/codex/src/plugin-sync.ts packages/codex/src/index.ts packages/codex/tests/marketplace-bundle.test.ts plugins/locus-memory/.mcp.json plugins/locus-memory/.codex-plugin/plugin.json .agents/plugins/marketplace.json
git commit -m "feat(codex): generate marketplace distribution bundle"
```

---

## Task B6: Package Tarball Acceptance

**Files:**
- Create or modify: `packages/codex/tests/package-contract.test.ts`
- Modify: `package.json`
- Modify: `esbuild.config.ts`
- Modify: `.gitignore` if generated tarballs need ignore rules

- [x] **Step 1: Write failing pack smoke test**

Add tests or a script-backed test that validates:

- `npm pack --dry-run --json` includes `dist/server.js`
- includes `dist/cli.js`
- includes `packages/codex/skills/locus-memory/SKILL.md`
- excludes tests and source files not needed at runtime
- package has `bin.locus-memory`

Run:

```bash
npm test -- packages/codex/tests/package-contract.test.ts
```

Expected: FAIL until build/files are correct.

- [x] **Step 2: Build package outputs**

Run:

```bash
npm run build
```

Expected: creates `dist/server.js` and `dist/cli.js`.

- [x] **Step 3: Inspect npm pack dry run**

Run:

```bash
npm pack --dry-run --json
```

Expected: output includes only intended runtime files.

- [x] **Step 4: Pack local tarball**

Run:

```bash
npm pack
```

Expected: creates `locus-memory-<version>.tgz`.

- [x] **Step 5: Smoke CLI from tarball**

Run in a temporary directory:

```bash
npm install C:\path\to\locus-memory-<version>.tgz
npx locus-memory --help
npx locus-memory doctor codex
```

Expected:

- help works
- doctor runs without mutating config
- no TypeScript runtime required

- [x] **Step 6: Do not commit tarball**

Remove or ignore generated `.tgz` after validation.

- [x] **Step 7: Verify tests**

Run:

```bash
npm test -- packages/codex/tests/package-contract.test.ts packages/cli/tests
npm run build
```

Expected: PASS.

- [x] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json esbuild.config.ts packages/codex/tests/package-contract.test.ts packages/cli .gitignore
git commit -m "test(package): validate npm tarball runtime"
```

---

## Task B7: Local Codex Install Smoke

**Files:**
- Modify: `docs/superpowers/plans/2026-04-24-track-b-one-command-install.md`

- [x] **Step 1: Archive current local Codex config state**

Run:

```bash
codex mcp get locus
codex mcp list
```

Expected: current state recorded in terminal output. Do not manually edit user config.

- [x] **Step 2: Install from local tarball**

Result update from local smoke: a tarball-run installer must not leave recurring Codex config pointing at `locus-memory@3.4.0` until that package exists in npm. The installer now preflights `npm exec -y locus-memory@<version> -- --help` before mutating Codex config. If the package is unavailable, it aborts with "No Codex MCP config was changed." Package-owned fresh runtime validation moves to post-publish validation.

Run:

```bash
npx -y .\locus-memory-<version>.tgz install codex --yes
```

Expected:

- before npm publish: command aborts without mutating Codex config when the pinned runtime package is unavailable
- after npm publish: command completes, MCP server is configured as package runtime, and skill path is created or updated
- report shows operations
- install lock is acquired and released
- npm runtime cache warming is attempted before Codex config mutation

- [x] **Step 3: Verify Codex MCP config**

Pre-publish local config was restored to the known-good local development runtime:

```text
command: node
args: C:\Users\Admin\gemini-project\ClaudeMagnificoMem\dist\server.js
env: CODEX_HOME, LOCUS_CAPTURE_LEVEL=redacted, LOCUS_CODEX_CAPTURE=redacted, LOCUS_LOG=error
```

Package-owned `npx.cmd -y locus-memory@3.5.0 mcp` verification was completed in B10 after npm publish, including a disposable `CODEX_HOME` install and the local Codex config migration.

Run:

```bash
codex mcp get locus
codex mcp list
```

Expected:

- command is `npx` or `npx.cmd`
- args include `locus-memory@<version>` and `mcp`
- env includes `redacted` capture values
- no `@latest` in recurring runtime command

- [x] **Step 4: Run installer again**

Run:

```bash
npx -y .\locus-memory-<version>.tgz install codex --yes
```

Expected:

- mostly `unchanged`
- no duplicate server entries
- no stale locks or temp files are left behind

- [x] **Step 5: Simulate interrupted cleanup**

Create a stale Locus temp file and stale lock in a disposable fake `CODEX_HOME`, then run:

```bash
npx -y .\locus-memory-<version>.tgz install codex --yes --dry-run
```

Expected:

- stale state is detected
- safe stale temp files are cleaned or reported
- no memory data is touched

- [x] **Step 6: Fresh Codex runtime check**

Completed after npm publish. The local Codex config now uses the package-owned runtime:

```text
command: npx.cmd
args: -y locus-memory@3.5.0 mcp
```

`codex mcp list`, `codex mcp get locus`, and `npx -y locus-memory@3.5.0 doctor codex` all see the installed package runtime. The doctor reports `Ownership: missing` for the migrated legacy/manual entry, which is non-blocking and should be handled later as a cleanup/migration improvement.

Restart Codex session and run:

```text
memory_status
```

Expected:

- Locus tools visible
- capture level reports `redacted`
- Codex diagnostics present

- [x] **Step 7: Uninstall smoke**

Run:

```bash
npx -y .\locus-memory-<version>.tgz uninstall codex --yes
codex mcp list
```

Expected:

- Locus MCP entry removed or disabled according to implemented policy
- memory data remains untouched

- [x] **Step 8: Reinstall after uninstall**

Run:

```bash
npx -y .\locus-memory-<version>.tgz install codex --yes
codex mcp get locus
```

Expected: install works again cleanly.

- [x] **Step 9: Commit plan checkbox update**

Run:

```bash
git add docs/superpowers/plans/2026-04-24-track-b-one-command-install.md
git commit -m "docs(codex): record track b install smoke"
```

---

## Task B8: Documentation And Roadmap Truth Pass

**Files:**
- Modify: `README.md`
- Modify: `packages/codex/README.md`
- Modify: `packages/codex/config/config.toml.example`
- Modify: `docs/codex-vscode-extension.md`
- Modify: `docs/codex-acceptance-matrix.md`
- Modify: `docs/roadmap/codex-next.md`
- Modify: `docs/index.html`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v3.5.0.md`
- Modify: `packages/codex/tests/landing-page.test.ts`

- [x] **Step 1: Write failing docs/product tests**

Update or add tests asserting:

- landing page mentions `v3.5.0` or Track B current state
- README contains `npx -y locus-memory@latest install codex`
- README still contains manual MCP fallback
- README does not claim desktop/extension parity as validated
- Codex config example uses package runtime and pinned version for recurring MCP setup

Run:

```bash
npm test -- packages/codex/tests/landing-page.test.ts packages/codex/tests/package-contract.test.ts
```

Expected: FAIL until docs are updated.

- [x] **Step 2: Update README Quick Start**

Make Codex CLI Quick Start start with:

```bash
npx -y locus-memory@latest install codex
```

Move `codex mcp add locus -- node /path/to/locus/dist/server.js` into development/manual fallback.

- [x] **Step 3: Update Codex package docs**

Update `packages/codex/README.md`:

- install command
- doctor command
- uninstall command
- migration from manual MCP
- marketplace repo as distribution layer
- desktop/extension caveat

- [x] **Step 4: Update config example**

Update `packages/codex/config/config.toml.example`:

- package runtime example first
- pinned version in recurring config
- Windows `npx.cmd` note
- direct repo path as development fallback

- [x] **Step 5: Update acceptance matrix and roadmap**

Update:

- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`

Mark Track A as publicly released in `v3.4.0`.

Describe Track B as active or completed according to implementation state.

- [x] **Step 6: Update landing page**

Update `docs/index.html` and relevant tests:

- version / current release text
- one-command install section
- honest note about desktop/extension parity

Run:

```bash
npm run build:site
npm test -- packages/codex/tests/landing-page.test.ts
```

- [x] **Step 7: Add release notes**

Create `docs/releases/v3.5.0.md`:

- summary
- one-command install
- npm package
- marketplace bundle generation
- validation summary
- known limitations

- [x] **Step 8: Verify docs search**

Run:

```bash
rg -n "dist/server.js|coming soon|v3.4|v3.5|one-command|npx -y locus-memory|desktop" README.md packages/codex/README.md docs/codex-vscode-extension.md docs/roadmap/codex-next.md docs/index.html docs/releases/v3.5.0.md
```

Expected: no stale primary-install claims.

- [x] **Step 9: Commit**

Run:

```bash
git add README.md packages/codex/README.md packages/codex/config/config.toml.example docs/codex-vscode-extension.md docs/codex-acceptance-matrix.md docs/roadmap/codex-next.md docs/index.html docs/releases/v3.5.0.md packages/codex/tests/landing-page.test.ts CHANGELOG.md
git commit -m "docs(codex): document one-command install release"
```

---

## Task B9: Final Validation And Release Prep

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `packages/core/package.json`
- Modify: `packages/codex/package.json`
- Modify: `packages/cli/package.json`
- Modify: `packages/shared-runtime/package.json`
- Modify: `plugins/locus-memory/.codex-plugin/plugin.json`
- Modify: `docs/superpowers/plans/2026-04-24-track-b-one-command-install.md`

- [x] **Step 1: Align versions**

Set all public/workspace/plugin versions to the selected release version, likely `3.5.0`.

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

- [x] **Step 2: Run targeted tests**

Run:

```bash
npm test -- packages/cli/tests packages/codex/tests/package-contract.test.ts packages/codex/tests/marketplace-bundle.test.ts packages/codex/tests/plugin-bundle.test.ts
```

Expected: PASS.

- [x] **Step 3: Run full validation**

Run:

```bash
npm run build
npm run check
npm audit --audit-level=moderate
npm pack --dry-run --json
git diff --check
```

Expected:

- build passes
- full check passes
- audit reports 0 vulnerabilities or documented non-blocking dev-only issue
- pack dry run includes intended files
- diff check clean

- [x] **Step 4: Generate marketplace bundle**

Run:

```bash
npm run sync:codex-marketplace
```

Expected: `dist/marketplace/` generated and checked by tests.

- [x] **Step 5: Review final diff**

Run:

```bash
git status --short --branch
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

- [x] **Step 6: Update plan checkboxes**

Mark completed tasks in this file.

- [x] **Step 7: Final commit**

Run:

```bash
git add package.json package-lock.json packages/core/package.json packages/codex/package.json packages/cli/package.json packages/shared-runtime/package.json plugins/locus-memory/.codex-plugin/plugin.json docs/superpowers/plans/2026-04-24-track-b-one-command-install.md
git commit -m "chore(release): prepare v3.5.0"
```

- [x] **Step 8: Create local checkpoint tag**

Run:

```bash
git tag -a track-b-one-command-install-local -m "Track B one-command install local checkpoint"
```

---

## Task B10: Post-Publish Validation

**Files:**
- Modify: `docs/releases/v3.5.0.md`
- Modify: `docs/superpowers/plans/2026-04-24-track-b-one-command-install.md`

This task runs after npm publication and before final GitHub release publication. It is a release verification gate, not a substitute for local tarball acceptance. GitHub release page verification remains part of the final GitHub push/release workflow because it cannot be completed before the branch is pushed and the release is created.

- [x] **Step 1: Verify npm registry metadata**

Run:

```bash
npm view locus-memory@3.5.0 version dist.tarball dist.integrity bin --json
```

Expected:

- version is `3.5.0`
- package exposes the expected `locus-memory` bin
- tarball URL and integrity are present

Result:

```json
{
  "version": "3.5.0",
  "dist.tarball": "https://registry.npmjs.org/locus-memory/-/locus-memory-3.5.0.tgz",
  "bin": {
    "locus-memory": "dist/cli.js"
  }
}
```

- [x] **Step 2: Verify one-command install entrypoint from registry**

Use a disposable `CODEX_HOME` and run:

```bash
npx -y locus-memory@3.5.0 --help
npx -y locus-memory@3.5.0 doctor codex
npx -y locus-memory@3.5.0 install codex --yes --dry-run
```

Expected:

- CLI starts from npm registry
- doctor reports environment state without mutation
- dry-run reports pinned recurring runtime command
- no `@latest` is written into recurring MCP configuration

Result:

- `npx -y locus-memory@3.5.0 --version` returned `3.5.0`
- `npx -y locus-memory@3.5.0 --help` showed `mcp`, `install codex`, `doctor codex`, and `uninstall codex`
- `npx -y locus-memory@3.5.0 doctor codex` ran without mutation
- `npx -y locus-memory@3.5.0 install codex --yes --dry-run` reported `npx -y locus-memory@3.5.0 mcp`

- [x] **Step 3: Verify real install in a disposable Codex home**

Run the installer against a disposable Codex home, not the user's primary Codex config:

```bash
npx -y locus-memory@3.5.0 install codex --yes
npx -y locus-memory@3.5.0 doctor codex
```

Expected:

- MCP entry is package-owned
- skill is installed
- capture defaults are `redacted`
- install lock and temp files are not left behind

Result:

- disposable `CODEX_HOME` install completed
- generated `config.toml` used:

```toml
[mcp_servers.locus]
command = "npx.cmd"
args = ["-y", "locus-memory@3.5.0", "mcp"]

[mcp_servers.locus.env]
LOCUS_CAPTURE_LEVEL = "redacted"
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_LOG = "error"
```

- `skills/locus-memory/SKILL.md` existed after install

- [x] **Step 4: Verify marketplace artifact**

Check the generated marketplace distribution and the marketplace repository/release process used for this release.

Expected:

- plugin manifest version matches `3.5.0`
- plugin MCP config uses a pinned runtime package specifier
- marketplace repository is a thin distribution layer, not a second source of product logic

Result:

- local `dist/marketplace/` generation is validated by tests and `npm run sync:codex-marketplace`
- generated marketplace config uses pinned `locus-memory@3.5.0`
- no second marketplace repository is mutated by the sync script
- publishing/pushing a separate marketplace repository remains a distribution step outside this repo-local plan

- [x] **Step 5: Verify prepared public release surfaces**

Check:

- GitHub release page
- README install section
- project landing page
- `docs/releases/v3.5.0.md`

Expected: all prepared public surfaces tell the same install story and do not claim unverified Codex desktop / extension parity. The live GitHub release page is verified in the final GitHub release publication step.

Result:

- README, Codex docs, landing page, changelog, and `docs/releases/v3.5.0.md` were updated for the `v3.5.0` install story
- GitHub release page verification is pending final GitHub release creation
- docs do not claim validated Codex desktop / extension parity

- [x] **Step 6: Document rollback/hotfix path if validation fails**

If post-publish validation fails:

- prefer a patch release over rewriting history
- document the failure and workaround in the release notes
- use `npm deprecate locus-memory@3.5.0 "<reason>"` only if the published package is misleading or unsafe
- avoid `npm unpublish` unless the package is truly broken and npm policy/time window makes it safe

- [x] **Step 7: Commit post-publish notes**

Run:

```bash
git add docs/releases/v3.5.0.md docs/superpowers/plans/2026-04-24-track-b-one-command-install.md
git commit -m "docs(release): record v3.5.0 post-publish validation"
```

Result: this documentation update records the post-publish validation and should be committed before the GitHub push/release step.

---

## Execution Notes

- Keep `@latest` only in the user-run install command.
- Never write `@latest` into recurring MCP runtime config.
- Prefer `codex mcp add/remove` over direct TOML edits.
- If direct TOML edits become necessary, create backup first and keep mutation narrow.
- Do not let `sync:codex-marketplace` commit or push another repository.
- Preserve manual MCP fallback docs until package install is proven from tarball and, later, from npm registry.
- Do not publish to npm until local tarball install and Codex smoke checks pass.
- Do not claim Codex desktop / extension parity until tested in that surface.
