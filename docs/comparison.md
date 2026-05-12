# Locus Competitive Comparison

This page compares Locus with real memory projects in the AI-agent and AI-coding-agent space.

The goal is not to claim that Locus is bigger than every alternative. It is not. Locus is intentionally a smaller local memory layer focused on Codex CLI and MCP-based coding workflows.

Sources reviewed on 2026-05-12:

- [agentmemory](https://github.com/rohitg00/agentmemory)
- [AIDE Memory](https://www.aide-memory.dev/)
- [Mem0](https://github.com/mem0ai/mem0)
- [Letta](https://github.com/letta-ai/letta)
- [Zep / Graphiti](https://github.com/getzep/graphiti)

## Positioning

| Project | Category | Best fit |
| --- | --- | --- |
| Locus | Local MCP memory for coding tools | Codex CLI users who want persistent project memory without running a separate platform |
| agentmemory | Broad coding-agent memory stack | Users who want a large memory system with many hooks, tools, viewer, and benchmark-driven positioning |
| AIDE Memory | Local path-scoped coding memory | Users who want lightweight path-based memory and tiny context nudges |
| Mem0 | General-purpose memory layer for agents | Application developers adding memory to products, assistants, and agent frameworks |
| Letta | Stateful agent runtime/platform | Teams building agents inside the Letta runtime |
| Zep / Graphiti | Temporal graph context infrastructure | Production apps that need graph-based context, temporal facts, and managed or self-hosted infrastructure |

## Feature Comparison

| Capability | Locus | agentmemory | AIDE Memory | Mem0 | Letta | Zep / Graphiti |
| --- | --- | --- | --- | --- | --- | --- |
| Primary target | AI coding tools, Codex first | AI coding agents broadly | AI coding agents | AI agents and apps | Stateful agents | Production agent context |
| Install style | `npx locus-memory install codex` | npm / MCP server | `npx aide-memory init` | pip/npm SDK, server, cloud | CLI/API platform | SDK / platform / graph engine |
| MCP support | Native MCP server | Native MCP server | MCP-compatible | MCP/integrations vary by package | Platform/agent runtime | Graphiti MCP exists; Zep is platform-oriented |
| Local-first | Yes | Yes by default | Yes | Optional; cloud and self-hosted exist | Local and hosted paths | Graphiti self-hosted; Zep platform |
| Default storage | SQLite | Local engine/storage stack | SQLite/files | Vector stores / graph / managed service options | Letta runtime storage | Temporal graph backends / platform |
| Needs LLM/embeddings to write core memory | No for structural, explicit, and Codex ingest paths | Uses compression/embedding pipeline depending on config | Not positioned as required in basic flow | Yes for memory extraction/retrieval quality | Yes, agent runtime driven | Yes for graph extraction/context workflows |
| Codex-first workflow | Yes | Supports Codex among many agents | Not Codex-first | Not coding-tool-first | Not Codex-first | Not Codex-first |
| One-command Codex setup | Yes | General MCP setup | General init | App integration | Runtime install | App/infrastructure integration |
| Recall inspectability | `memory_review`, `memory_audit`, `memory_status`, `memory_doctor` | Viewer and audit features | Memory files / local model | Dashboard/API depending on mode | Platform tools | Graph/platform tooling |
| Privacy posture | Local by default; `metadata` / `redacted` / `full` modes | Local-first claims and filters | Local-first claims | Depends on cloud/self-hosted mode | Depends on deployment | Depends on deployment |

## Where Locus Is Strong

### Codex-first install and runtime

Locus is packaged around the Codex path:

```bash
npx -y locus-memory@latest install codex --yes
```

The installer configures MCP, installs the Codex skill, sets `redacted` capture defaults, and pins the recurring runtime command to the installed package version. That is narrower than a general memory platform, but easier for Codex users.

### Local memory without mandatory embeddings

Locus writes useful memory without calling an LLM or embedding provider:

- structural memory from scanner metadata
- explicit `memory_remember` decisions
- Codex JSONL event import
- SQLite FTS5 search with LIKE fallback

This keeps the base workflow cheap and predictable.

### Honest capture modes

Locus does not call every mode "semantic memory".

| Mode | Product meaning |
| --- | --- |
| `metadata` | safe diagnostics and limited recall |
| `redacted` | practical Codex recall with bounded snippets and best-effort redaction |
| `full` | maximum recall with explicit privacy warning |

### Debuggable memory

The project deliberately exposes diagnostics:

- `memory_status` for runtime state
- `memory_doctor` for actionable checks
- `memory_audit` for stored-data review
- `memory_review` for durable memories, states, topic keys, and evidence

This matters because memory systems lose trust when users cannot see what was saved or why.

## Where Competitors Are Stronger

| Competitor | Stronger area |
| --- | --- |
| agentmemory | Larger coding-agent feature surface, viewer, benchmark-heavy positioning, many tools/hooks |
| AIDE Memory | Very clear path-scoped UX and small context nudge |
| Mem0 | Much larger ecosystem, hosted/self-hosted options, SDKs, app-level memory use cases |
| Letta | Full stateful agent platform with advanced agent memory behavior |
| Zep / Graphiti | Temporal knowledge graphs, graph provenance, production context infrastructure |

## Honest Locus Limitations

- Codex CLI is validated first; Codex desktop / extension parity is not claimed until tested in that surface.
- Secondary IDEs can use MCP tools, but passive conversation capture adapters are still future work.
- Locus does not yet ship a full HTML memory dashboard.
- Locus does not currently provide vector/graph retrieval as its default path.
- `redacted` is practical, not perfect; secret redaction is best-effort defense in depth.

## Recommended User Choice

Choose Locus if:

- you mainly use Codex CLI
- you want local memory with minimal setup
- you want MCP tools, inspectability, and clear privacy modes
- you do not want to run a separate memory platform

Choose a competitor if:

- you need graph memory at production scale
- you want hosted dashboards and managed APIs
- you are building an application memory layer rather than improving a coding assistant
- you want a full agent runtime instead of a memory add-on
