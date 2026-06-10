# Locus

> 面向 AI 编程工具的本地持久记忆。基于 MCP 构建，当前优先支持 Codex CLI。

![Locus hero image](assets/social-preview-github.jpg)

[English](../README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md)

## Locus 是什么

AI 编程代理在新会话中通常会忘记项目背景：架构决策、用户偏好、上次修复的问题、下一步计划。Locus 提供一个本地记忆数据库，并通过 MCP 工具让代理查询这些信息。

Locus 可以保存：

- 项目结构：文件、exports、imports
- 重要决策：架构选择、限制、用户偏好
- Codex 会话上下文：错误、后续步骤、被否决的方案、验证结果
- 诊断信息：导入了什么、保存了什么、当前 capture 模式是什么

Locus 默认本地优先。写入记忆不需要云账号、外部数据库、embedding 服务或 LLM 调用。

## Codex 安装

```bash
npx -y locus-memory@latest install codex --yes
```

重启 Codex，然后检查安装状态：

```bash
npx -y locus-memory@latest doctor codex
```

移除 Codex MCP 配置，但保留本地记忆数据：

```bash
npx -y locus-memory@latest uninstall codex --yes
```

安装器会配置 Locus MCP server，安装 Codex skill，启用实用的 `redacted` capture 默认值，并把运行时命令固定到已安装的包版本。

## v3.7 新功能

Track D 增强了 Codex 记忆可靠性：项目级 recall、日期 buckets、用于时间段问题的 `memory_calendar`，以及用于当前项目状态的 `memory_project_state`。

`memory_recall` 现在也可以更好地回答关于过去工作的自然语言问题，例如 “昨天做了什么？”、“为什么放弃这个方案？”、“我的代码风格是什么？”、“下一步是什么？”。

它会结合 redacted Codex 会话、durable memories、`memory_remember`、rejected alternatives、validation facts 和时间范围问题。若存在多个可能答案，Locus 会返回 `candidateGroups`，让代理先向用户澄清，而不是猜测。

## 为什么选择 Locus

| 需求 | Locus 的做法 |
| --- | --- |
| Codex 一条命令安装 | `npx -y locus-memory@latest install codex --yes` |
| 本地存储 | SQLite，位于 `$CODEX_HOME/memory/`、`~/.claude/memory/` 或 `~/.locus/memory/` |
| 低 token 成本 | 写入在本地完成；只有 recall 时才消耗上下文 |
| 隐私控制 | `metadata`、`redacted`、`full` 三种 capture 模式 |
| 项目级记忆 | 结构扫描 + 决策 + 会话事件 |
| 可检查性 | `memory_status`、`memory_project_state`、`memory_doctor`、`memory_audit`、`memory_review` |

## Capture 模式

| 模式 | 适合场景 | 行为 |
| --- | --- | --- |
| `metadata` | 最安全的诊断模式 | 内容很少，recall 能力有限 |
| `redacted` | 推荐的 Codex 实用模式 | 保存有限片段和关键词，并做 best-effort secret redaction |
| `full` | 最大 recall | 保存更多本地文本；需要明确理解隐私风险 |

推荐的 Codex 设置：

```bash
LOCUS_CODEX_CAPTURE=redacted
LOCUS_CAPTURE_LEVEL=redacted
```

## 对比

Locus 不试图成为完整 agent runtime 或云端记忆平台。它的定位是：轻量、本地、Codex-first 的 coding-agent memory layer。

| 项目 | 主要优势 | Locus 的差异 |
| --- | --- | --- |
| [agentmemory](https://github.com/rohitg00/agentmemory) | 面向 coding agents 的大型 memory stack | Locus 更小、更简单、Codex-first，并通过一个 npm MCP runtime 安装 |
| [AIDE Memory](https://www.aide-memory.dev/) | Path-scoped 本地记忆 | Locus 更强调 MCP tools、Codex JSONL import、诊断和 recall UX |
| [Mem0](https://github.com/mem0ai/mem0) | 通用 AI agents memory layer，生态大 | Locus 更像开箱即用的 coding-tool MCP memory |
| [Letta](https://github.com/letta-ai/letta) | 完整 stateful-agent 平台 | Locus 不替换现有 agent，只给现有工具增加记忆 |
| [Zep / Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graph 和生产级 context infrastructure | Locus 默认更轻、更本地，适合个人 coding workflow |

完整对比：[comparison.md](comparison.md)

## 常用 MCP 工具

- `memory_recall` — 回答关于过去工作的总结型问题
- `memory_search` — 搜索项目结构、决策和会话事件
- `memory_remember` — 保存重要决策或偏好
- `memory_review` — 查看保存了什么以及为什么保存
- `memory_import_codex` — 手动导入 Codex rollout JSONL
- `memory_status` / `memory_doctor` — 诊断运行状态
- `memory_audit` — 数据和隐私审计
- `memory_forget` / `memory_purge` — 安全删除记忆

## 客户端状态

| 客户端 | 状态 |
| --- | --- |
| Codex CLI | 主要验证路径 |
| Claude Code | 通过 hooks 和 shared runtime 支持 |
| Codex desktop / extension | 使用相同 MCP 模型，但 parity 仍未完全验证 |
| Cursor / Windsurf / Cline / Zed | MCP tools 可用；被动会话 adapters 是未来工作 |

## 开发

```bash
git clone https://github.com/Magnifico4625/locus.git
cd locus
npm install
npm run check
npm run build
```

License: MIT.
