# Track B: Codex One-Command Install Design

**Date:** 2026-04-24
**Status:** draft design for user review
**Primary users:** new Codex CLI users first, Codex desktop / extension users second
**Primary problem:** Locus now has validated Codex memory behavior, but installation still assumes a repo checkout, local build, manual MCP configuration, and optional manual skill/plugin sync.

---

## Purpose

This document defines the product contract and architecture boundaries for `Track B` in [docs/roadmap/codex-next.md](C:/Users/Admin/gemini-project/ClaudeMagnificoMem/docs/roadmap/codex-next.md).

Track A shipped the memory-trust baseline in `v3.4.0`: Codex CLI can use practical `redacted` recall, current Codex JSONL is parsed, and docs now distinguish useful recall from import plumbing.

Track B is the next product step: make Locus easy to install for Codex users without cloning and building the repository manually.

The desired user-facing outcome is:

```bash
npx -y locus-memory@latest install codex
```

After that, a normal Codex CLI session should expose Locus MCP tools, use the recommended `redacted` capture mode, and give users a clear diagnostic path if something is wrong.

---

## Current State

As of `v3.4.0`, Locus already has:

- a built MCP server entrypoint at `dist/server.js`
- a repo-local Codex plugin bundle at `plugins/locus-memory/`
- a repo-local marketplace at `.agents/plugins/marketplace.json`
- a canonical Codex skill at `packages/codex/skills/locus-memory/SKILL.md`
- sync helpers:
  - `npm run sync:codex-skill`
  - `npm run sync:codex-plugin`
- validated Codex CLI recall behavior in `redacted` mode

But the install story is still developer-centric:

- root `package.json` is `private: true`
- the npm badge points to a package name that is not published yet
- plugin `.mcp.json` points at `../../dist/server.js`, which only works for repo-local development
- docs still start with manual `codex mcp add locus -- node /path/to/locus/dist/server.js`
- users must understand Codex config, skill sync, plugin sync, and capture env settings

This is acceptable for development, but not for a public Codex product path.

---

## Upstream Codex Facts

Track B targets current Codex behavior, not assumptions from older docs.

Validated local CLI:

- `codex-cli 0.124.0`

Relevant official release facts:

- Codex `0.121.0` added `codex plugin marketplace add` and app-server support for installing plugin marketplaces from GitHub, git URLs, local directories, and direct `marketplace.json` URLs.
- Codex `0.124.0` added remote plugin marketplace list/read improvements and stable hooks configurable through `config.toml` / `requirements.toml`.
- `codex mcp add` supports stdio MCP servers with repeated `--env KEY=VALUE` settings.
- Current CLI help exposes `codex plugin marketplace add|upgrade|remove`; it does not yet prove a simple CLI-only plugin install flow that can replace npm-based setup.

Design implication:

- marketplace support is important for discovery and future desktop/plugin UX
- npm/npx remains the most reliable one-command install path for the runtime and local Codex configuration

Primary references:

- https://github.com/openai/codex/releases/tag/rust-v0.121.0
- https://github.com/openai/codex/releases/tag/rust-v0.124.0
- https://github.com/openai/plugins

---

## Design Goals

Track B must deliver:

1. **One-command Codex CLI install**
   A new user should be able to install Locus into Codex CLI without cloning the repository.

2. **Packaged runtime**
   The MCP server should run from a published npm package, not from a local `dist/server.js` path in a repository checkout.

3. **Idempotent setup**
   Running the installer repeatedly should update or confirm the existing installation instead of creating duplicates.

4. **Safe rollback**
   Installer changes to Codex config or local skill/plugin files must be reversible or backed up.

5. **Marketplace-ready distribution**
   The marketplace repo should become a thin generated distribution layer for discovery and plugin metadata, not a second source of truth.

6. **Windows-first correctness**
   Windows path behavior, `npx.cmd`, TOML strings, `CODEX_HOME`, and PowerShell usage must be first-class acceptance targets.

7. **Docs truthfulness**
   README and install docs must describe one-command install only after it is validated from a package artifact.

---

## Non-Goals

Track B does not try to deliver:

- a new memory model
- richer recall ranking
- a dashboard
- broad secondary IDE adapters
- major Claude Code behavior changes
- a remote hosted MCP service
- silent destructive cleanup of existing user config
- official OpenAI marketplace inclusion as a hard dependency

Track B may create a separate marketplace repository, but that repo must stay a packaging layer.

---

## Product Contract

The primary install command should be:

```bash
npx -y locus-memory@latest install codex
```

The CLI should expose at least:

```bash
locus-memory mcp
locus-memory install codex
locus-memory doctor codex
locus-memory uninstall codex
```

### `locus-memory mcp`

Starts the Locus MCP server over stdio.

Expected use inside Codex config:

```toml
[mcp_servers.locus]
command = "npx"
args = ["-y", "locus-memory@3.x", "mcp"]

[mcp_servers.locus.env]
LOCUS_LOG = "error"
LOCUS_CODEX_CAPTURE = "redacted"
LOCUS_CAPTURE_LEVEL = "redacted"
```

On Windows, the generated config may use `npx.cmd` if needed.

### `locus-memory install codex`

Installs or updates the Codex CLI integration.

Responsibilities:

- check Node.js version
- check whether `codex` is available
- detect Codex CLI version
- configure MCP server with safe default env values
- install or update the Codex skill
- preserve existing manual users where possible
- show a concise verification command

Default capture policy:

- `LOCUS_CODEX_CAPTURE=redacted`
- `LOCUS_CAPTURE_LEVEL=redacted`

Rationale:

- `metadata` is too weak for the public memory promise
- `redacted` is the validated practical recall mode
- `full` remains explicit opt-in warning territory

### `locus-memory doctor codex`

Checks install state without mutating config.

At minimum, it should report:

- Node version
- Codex CLI availability and version
- detected `CODEX_HOME`
- configured Locus MCP server command
- configured capture env values
- installed skill presence
- package/runtime version
- suggested next command

### `locus-memory uninstall codex`

Removes or disables what the installer added.

It should:

- remove the Locus MCP server entry when it owns that entry
- remove or leave skill files based on a clear policy
- preserve backups
- avoid deleting user memory databases

Memory data removal remains a separate explicit Locus operation, not part of uninstall.

---

## Package Contract

The main repo should publish the `locus-memory` npm package.

The package name is currently available in npm registry checks.

Required package properties:

- no longer `private: true`
- `bin` entry for `locus-memory`
- `main` remains compatible with MCP server usage where useful
- `files` includes only required runtime assets:
  - `dist/`
  - `packages/codex/skills/locus-memory/SKILL.md` or generated equivalent
  - license/readme/package metadata
  - installer support files if separate from `dist`
- `prepublishOnly` validates build and tests
- `npm pack` output is inspected and tested before publish

The package should avoid requiring a TypeScript runtime at install time.

The published artifact should contain built JavaScript only for runtime paths.

---

## Installer Strategy

The installer should prefer official Codex commands where stable.

Preferred MCP setup path:

```bash
codex mcp add locus \
  --env LOCUS_LOG=error \
  --env LOCUS_CODEX_CAPTURE=redacted \
  --env LOCUS_CAPTURE_LEVEL=redacted \
  -- npx -y locus-memory@<version> mcp
```

If `codex mcp add` cannot express a required setting reliably on a supported platform, the installer may edit `~/.codex/config.toml`, but only with:

- parser-aware or minimally scoped mutation
- backup before write
- clear changed-file output
- idempotency tests

The installer should not overwrite unrelated Codex configuration.

---

## Idempotency And Ownership

Installer state should be explicit enough to avoid duplicate or destructive behavior.

Rules:

- if `mcp_servers.locus` already points to a Locus package command, update it in place
- if it points to a manual local repo path, ask or print a clear migration choice unless a `--yes` flag is used
- if the skill exists and matches, leave it alone
- if the skill exists and differs, back it up or write only after explicit confirmation / `--yes`
- repeated `install codex --yes` should converge to the same config

The installer should report:

- `created`
- `updated`
- `unchanged`
- `backed_up`
- `skipped`

---

## Rollback And Backup

Track B must treat config mutation as a user-trust boundary.

Before changing user-owned files, the installer should create backups for:

- `~/.codex/config.toml` when direct editing is used
- `$CODEX_HOME/skills/locus-memory/SKILL.md` when overwriting a different file
- installed plugin files if the installer writes them directly in a future path

Backup names should include a timestamp.

Uninstall should not delete:

- `$CODEX_HOME/memory/`
- Locus SQLite databases
- user-created memories

Data deletion remains controlled by `memory_purge`, `memory_forget`, and related memory tools.

---

## Marketplace Strategy

Track B should use a separate marketplace repository as a thin distribution layer.

Candidate repo:

- `Magnifico4625/locus-codex-marketplace`

Expected shape:

```text
.agents/plugins/marketplace.json
plugins/locus-memory/.codex-plugin/plugin.json
plugins/locus-memory/.mcp.json
plugins/locus-memory/skills/locus-memory/SKILL.md
README.md
```

The marketplace repo should not contain canonical runtime logic.

The main repo should own a sync/generation script, likely:

```bash
npm run sync:codex-marketplace
```

That script should generate the marketplace bundle from canonical sources:

- package version
- plugin metadata
- canonical skill
- packaged MCP command

Plugin `.mcp.json` for public distribution should use the npm runtime:

```json
{
  "mcpServers": {
    "locus": {
      "command": "npx",
      "args": ["-y", "locus-memory@3.x", "mcp"],
      "env": {
        "LOCUS_LOG": "error",
        "LOCUS_CODEX_CAPTURE": "redacted",
        "LOCUS_CAPTURE_LEVEL": "redacted"
      }
    }
  }
}
```

The repo-local dev plugin may keep a local path mode, but public marketplace output must not depend on `../../dist/server.js`.

---

## Desktop / Extension Positioning

Codex CLI remains the hard acceptance path for Track B.

Codex desktop / extension should be documented as:

- likely to benefit from the same Codex config when the upstream surface exposes MCP and plugins
- not a separate Locus runtime
- still subject to upstream plugin UI and marketplace behavior

Docs must not claim desktop/extension parity until tested there.

Installer diagnostics should make this clear:

- CLI install verified
- desktop/extension visibility unverified unless explicitly checked

---

## Documentation Contract

After Track B is validated, README Quick Start should lead with:

```bash
npx -y locus-memory@latest install codex
```

Manual setup becomes a fallback:

```bash
codex mcp add locus -- npx -y locus-memory@latest mcp
```

Repo clone + `dist/server.js` becomes a development path, not the primary user path.

Docs to update:

- `README.md`
- `packages/codex/README.md`
- `packages/codex/config/config.toml.example`
- `docs/codex-vscode-extension.md`
- `docs/codex-acceptance-matrix.md`
- `docs/roadmap/codex-next.md`
- GitHub Pages landing page
- release notes

Docs must also explain:

- how to verify install
- how to migrate manual MCP users
- how to uninstall
- how to opt into `full`
- how to keep `metadata` for privacy-first diagnostics

---

## Testing And Acceptance

Track B is not complete with unit tests alone.

Required validation layers:

### Unit tests

- CLI argument parsing
- platform command selection (`npx` vs `npx.cmd`)
- config generation
- idempotency classification
- backup naming
- skill copy/update behavior
- marketplace bundle generation
- version alignment checks

### Package tests

- `npm pack`
- inspect tarball contents
- install from local tarball in a temporary directory
- run `locus-memory --help`
- run `locus-memory mcp` smoke startup where practical

### Codex integration smoke

Using a local package tarball:

```bash
npx -y ./locus-memory-<version>.tgz install codex --yes
codex mcp list
```

Then in a fresh Codex session:

- run `memory_status`
- confirm Locus MCP tools are visible
- confirm capture mode is `redacted`

### Idempotency smoke

Run installer twice.

Expected:

- second run reports mostly `unchanged`
- no duplicate MCP server entries
- no duplicate skill directories

### Uninstall smoke

Run uninstall.

Expected:

- MCP server entry removed or disabled
- memory data preserved
- backups preserved
- reinstall still works

---

## Release Shape

Track B likely maps to `v3.5.0` rather than `v3.4.x`.

Reason:

- it adds a new public install surface
- it publishes a runtime package
- it introduces CLI commands
- it changes the public onboarding path

A patch release would undersell the product change.

Possible release sequence:

1. local implementation branch
2. package tarball validation
3. local Codex install validation
4. npm dry-run / publish readiness
5. publish npm package
6. create or update marketplace repo
7. update README / landing / release notes
8. tag and GitHub release

---

## Decomposition

Track B should be implemented as separate implementation plans or separate task groups inside one plan.

### B1 — Publishable Runtime Package

Scope:

- package metadata
- bin entry
- built runtime assets
- `npm pack` contract
- package content tests

### B2 — CLI Command Surface

Scope:

- `locus-memory mcp`
- `locus-memory install codex`
- `locus-memory doctor codex`
- `locus-memory uninstall codex`
- help text

### B3 — Codex Installer

Scope:

- Codex detection
- MCP config setup
- capture env defaults
- skill install/update
- backup and rollback
- idempotency

### B4 — Marketplace Distribution

Scope:

- public plugin `.mcp.json` uses npm runtime
- marketplace bundle generation
- separate marketplace repo sync docs
- version alignment

### B5 — Install Acceptance

Scope:

- local tarball install
- Codex CLI smoke
- repeated install
- uninstall/reinstall
- Windows path validation

### B6 — Docs And Release Truth Pass

Scope:

- README Quick Start
- Codex docs
- VS Code / desktop caveats
- roadmap
- landing page
- release notes

---

## Key Risks

1. **Marketplace overreach**
   Marketplace support is evolving. The npm installer must remain the primary install path until plugin install UX is proven end-to-end.

2. **Broken user config**
   Direct TOML edits can damage existing Codex config. Prefer `codex mcp add/remove`; back up before any direct edit.

3. **Version drift**
   npm package, plugin manifest, marketplace entry, docs, and generated bundle can drift unless checked automatically.

4. **Windows command mismatch**
   `npx` vs `npx.cmd`, spaces in paths, and TOML escaping can break the most important local validation environment.

5. **Desktop parity claims**
   Desktop/extension behavior may lag CLI. Docs and diagnostics must avoid claiming parity without runtime evidence.

6. **Manual user regression**
   Users who already configured `node /path/to/locus/dist/server.js` should not be broken by the new installer.

---

## Final Product Direction

Track B should make Locus feel installable as a real Codex product:

- one command to install
- one command to diagnose
- one command to uninstall
- npm package as the runtime source
- marketplace as discovery and plugin packaging
- manual MCP as a supported fallback

The product promise should become:

> Install Locus into Codex with one command, verify it in one command, and keep full control over local memory and config.
