# Locus

> Local persistent memory for AI coding tools. Built on MCP. Optimized for Codex CLI.

![Locus hero image](docs/assets/social-preview-github.jpg)

[![npm version](https://img.shields.io/npm/v/locus-memory)](https://www.npmjs.com/package/locus-memory)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io)
[![Compare](https://img.shields.io/badge/compare-vs%20agent%20memory%20tools-B7F34A?labelColor=111111)](docs/comparison.md)

<p>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/English-README-222222"></a>
  <a href="docs/README.ru.md"><img alt="Russian README" src="https://img.shields.io/badge/Русский-README-222222"></a>
  <a href="docs/README.zh-CN.md"><img alt="Chinese README" src="https://img.shields.io/badge/简体中文-README-222222"></a>
</p>

**Quick links:** [Install](#install-for-codex) · [Why Locus](#why-choose-locus) · [Competitive Snapshot](#competitive-snapshot) · [Full comparison](docs/comparison.md)

## What Locus Does

AI coding agents forget project context between sessions. Locus gives them a local memory database they can query through MCP:

- project structure: files, exports, imports
- saved decisions: architecture choices, preferences, constraints
- Codex conversation recall: recent work, errors, rejected alternatives, next steps
- diagnostics: what is stored, what was imported, what capture mode is active

Locus is local-first. It stores data on your machine, uses SQLite, and does not require a cloud account, hosted database, embeddings provider, or LLM call to write memory.

## Install For Codex

```bash
npx -y locus-memory@latest install codex --yes
```

Restart Codex, then verify:

```bash
npx -y locus-memory@latest doctor codex
```

Remove the Codex MCP entry while keeping local memory data:

```bash
npx -y locus-memory@latest uninstall codex --yes
```

The installer adds the Locus MCP server, installs the Codex skill, sets practical `redacted` capture defaults, and pins the recurring MCP runtime to the installed package version.

## New In v3.6

**New in v3.6 / Track C:** richer Codex recall. `memory_recall` can summarize imported redacted Codex sessions, durable decisions, explicit `memory_remember` entries, rejected alternatives, validation facts, user style, and dated questions such as "what did we do yesterday?". If several matches are plausible, Locus returns `candidateGroups` so the agent can ask a focused clarification instead of guessing.

Codex CLI is the primary validated path. Codex desktop / extension uses the same MCP model where exposed by the upstream surface, but parity is still treated as unverified until tested there.

## Why Choose Locus

| Need | Locus approach |
| --- | --- |
| One-command Codex setup | `npx -y locus-memory@latest install codex --yes` |
| Local-only storage | SQLite under `$CODEX_HOME/memory/`, `~/.claude/memory/`, or `~/.locus/memory/` |
| Low token cost | Writes happen locally; tokens are spent only when the agent recalls memory |
| Privacy control | `metadata`, `redacted`, and `full` capture modes; `full` is explicit warning territory |
| Project-aware memory | Structural scan plus durable decisions and conversation events |
| Inspectability | `memory_status`, `memory_project_state`, `memory_doctor`, `memory_audit`, `memory_review` |
| Cross-client base | Any MCP client can use the server; Codex and Claude Code have the strongest adapters today |

## Competitive Snapshot

Locus is not trying to be a full agent runtime or cloud memory platform. It is a small local memory layer for coding agents, with Codex as the first-class product path.

| Project | Main strength | Trade-off vs Locus |
| --- | --- | --- |
| [agentmemory](https://github.com/rohitg00/agentmemory) | Very broad coding-agent memory stack with many tools, hooks, viewer, and benchmark claims | Larger system surface; Locus is smaller, simpler, Codex-first, and ships as one npm MCP runtime |
| [AIDE Memory](https://www.aide-memory.dev/) | Path-scoped local memory and very small context nudge | Locus focuses more on MCP tools, Codex JSONL import, diagnostics, and explicit recall UX |
| [Mem0](https://github.com/mem0ai/mem0) | Popular general-purpose memory layer for AI agents with SDKs, hosted/self-hosted options, and benchmarks | Usually an application integration layer; Locus is ready-to-use for coding tools through MCP |
| [Letta](https://github.com/letta-ai/letta) | Full stateful agent platform with advanced memory | More framework/runtime commitment; Locus plugs into existing tools instead of replacing them |
| [Zep / Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graphs and production context infrastructure | Strong for app/enterprise memory; Locus is lighter and local by default for individual coding workflows |

Full comparison: [docs/comparison.md](docs/comparison.md)

## Capture Modes

| Mode | Use it when | What to expect |
| --- | --- | --- |
| `metadata` | You want safest diagnostics-first behavior | Minimal content recall |
| `redacted` | You want practical Codex memory | Bounded snippets and keyword extraction with best-effort secret redaction |
| `full` | You explicitly want maximum recall | More content stored locally after redaction; not risk-free |

Recommended Codex settings:

```bash
LOCUS_CODEX_CAPTURE=redacted
LOCUS_CAPTURE_LEVEL=redacted
```

For product claims: `full` is maximum recall and must be treated as explicit opt-in, not a safe default.

## MCP Tools

Locus exposes 16 MCP tools:

| Tool | Purpose |
| --- | --- |
| `memory_recall` | Summary-first recall for questions about past work |
| `memory_calendar` | Discover day/week/month activity buckets for a project and time range |
| `memory_project_state` | Summarize project identity, package/git state, memory freshness, and active next steps |
| `memory_search` | Full-text search across structure, decisions, and conversation events |
| `memory_remember` | Save important decisions or preferences |
| `memory_review` | Inspect durable memories, states, evidence, and topic keys |
| `memory_import_codex` | Manually import Codex rollout JSONL sessions |
| `memory_timeline` | Chronological event feed |
| `memory_scan` | Index project structure |
| `memory_explore` | Browse indexed project structure |
| `memory_status` | Runtime state and Codex diagnostics |
| `memory_doctor` | Actionable health checks |
| `memory_audit` | Storage and privacy audit |
| `memory_config` | Show effective configuration |
| `memory_compact` | Prune old episodic entries |
| `memory_forget` / `memory_purge` | Delete selected or all memory with safety confirmation |

## Other Clients

Locus is an MCP server, so it can run in Claude Code, Cursor, Windsurf, Cline, Zed, Claude Desktop, and similar clients.

Current maturity:

| Surface | Status |
| --- | --- |
| Codex CLI | Primary validated path |
| Claude Code | Supported through hooks and shared runtime |
| Codex desktop / extension | Same config model where MCP is exposed; parity still unverified |
| Cursor / Windsurf / Cline / Zed | MCP tools work; passive conversation adapters are future work |

Manual MCP fallback:

```bash
codex mcp add locus -- node /path/to/locus/dist/server.js
```

## Docs

- Codex acceptance matrix: [docs/codex-acceptance-matrix.md](docs/codex-acceptance-matrix.md)
- Codex VS Code extension notes: [docs/codex-vscode-extension.md](docs/codex-vscode-extension.md)
- Future roadmap: [docs/roadmap/codex-next.md](docs/roadmap/codex-next.md)
- Release notes: [docs/releases/v3.6.1.md](docs/releases/v3.6.1.md)
- Full comparison: [docs/comparison.md](docs/comparison.md)

## Development

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install

npm run check
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
