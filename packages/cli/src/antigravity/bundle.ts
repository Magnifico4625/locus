import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureLevel } from '@locus/core';
import { installRuntimeFiles, syncTextAtomically } from '../runtime-install.js';

export interface WriteAntigravityPluginBundleOptions {
  targetDir: string;
  version?: string;
  startDir?: string;
  sourceDistDir?: string;
  captureLevel?: CaptureLevel;
  now?: Date;
}

export interface WriteAntigravityPluginBundleResult {
  action: 'installed' | 'updated' | 'unchanged';
  pluginDir: string;
  version: string;
  runtimeDir: string;
  files: string[];
}

export function buildAntigravityPluginManifest(version: string): Record<string, unknown> {
  return {
    name: 'locus-memory',
    displayName: 'Locus Memory',
    version,
    description:
      'Persistent project-aware memory for Antigravity Desktop with zero-call context hooks, automatic capture, and local SQLite MCP recall.',
    suggestedPrompts: [
      'What architectural decisions and next steps are active in this project?',
      'Search project memory for recent work and unresolved blockers.',
      'Check Locus memory status and review durable decisions.',
    ],
    author: {
      name: 'Magnifico4625',
      url: 'https://github.com/Magnifico4625',
    },
    homepage: 'https://github.com/Magnifico4625/locus',
    repository: 'https://github.com/Magnifico4625/locus',
  };
}

const PLUGIN_ROOT_SERVER_ARG = ['$', '{PLUGIN_ROOT}/runtime/server.js'].join('');

export function buildAntigravityHooksJson(): Record<string, unknown> {
  return {
    'locus-memory': {
      SessionStart: [
        {
          type: 'command',
          command: 'node hooks/locus-hook.mjs session-start',
          timeout: 15,
        },
      ],
      PreInvocation: [
        {
          type: 'command',
          command: 'node hooks/locus-hook.mjs pre-invocation',
          timeout: 15,
        },
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node hooks/locus-hook.mjs post-tool-use',
              timeout: 15,
            },
          ],
        },
      ],
      Stop: [
        {
          type: 'command',
          command: 'node hooks/locus-hook.mjs stop',
          timeout: 20,
        },
      ],
    },
  };
}

export function buildAntigravityHookRunnerScript(): string {
  return [
    "import { runCli } from '../runtime/cli.js';",
    '',
    'const event = process.argv[2];',
    'if (!event) {',
    "  process.stdout.write('{}\\n');",
    '  process.exit(0);',
    '}',
    '',
    "const exitCode = await runCli(['hook', 'antigravity', event]);",
    'process.exitCode = exitCode;',
    '',
  ].join('\n');
}

export function buildAntigravityMcpConfigJson(
  captureLevel: CaptureLevel = 'redacted',
): Record<string, unknown> {
  return {
    mcpServers: {
      locus: {
        command: 'node',
        args: [PLUGIN_ROOT_SERVER_ARG],
        env: {
          LOCUS_CLIENT: 'antigravity',
          LOCUS_CLIENT_SURFACE: 'desktop',
          LOCUS_CAPTURE_LEVEL: captureLevel,
          LOCUS_LOG: 'error',
        },
      },
    },
  };
}

export function buildAntigravityRulesMarkdown(): string {
  return [
    '# Locus Persistent Memory',
    '',
    'Locus injects relevant project context automatically via lifecycle hooks (`SessionStart`, `PreInvocation`) and captures workspace progress locally via `PostToolUse` and `Stop`.',
    '',
    '## Working Rules',
    '',
    '- Treat injected `[Locus Memory — Project Brief]` and `[Locus Memory — Relevant Recall]` system messages as verified prior local project context, and cross-check file state in the current workspace before acting.',
    '- Do NOT call `memory_recall`, `memory_search`, or `memory_status` redundantly on simple continuation turns when automatic context already answered the question.',
    '- Use `memory_recall` first for deep historical questions about past decisions, bugs, or dates (e.g., "what did we decide last week?").',
    '- Use `memory_calendar` for date-range discovery and `memory_project_state` when package, git, or next-step freshness matters.',
    '- Use `memory_remember` proactively when an important architectural decision, invariant, or user constraint is settled.',
    '- Use `memory_review` or `memory_forget` when inspecting or cleaning up stored durable memories.',
    '- Keep project-scoped recall isolated to the current workspace unless global recall is explicitly requested.',
    '',
  ].join('\n');
}

export function buildAntigravitySkillMarkdown(): string {
  return [
    '---',
    'name: locus-memory',
    'description: >',
    '  Persistent local SQLite project memory for Antigravity Desktop. Zero-call hooks inject',
    '  bounded context automatically; invoke deep MCP tools for date queries, saving decisions,',
    '  project exploration, and memory inspection.',
    '---',
    '',
    '# Locus Memory (Antigravity Desktop)',
    '',
    'Locus runs locally on your machine using SQLite with secret redaction and project-level isolation.',
    '',
    '## Zero-Call Lifecycle Hooks',
    '',
    '- **SessionStart**: injects a compact project state, active decisions, and recent files brief.',
    '- **PreInvocation**: injects relevant prompt recall when needed (skips noisy confirmations and duplicates).',
    '- **PostToolUse**: captures mutated file paths, shell commands, and tool errors asynchronously into the local inbox.',
    '- **Stop**: incrementally imports finalized transcript steps and extracts durable memories.',
    '',
    '## Deep MCP Tools',
    '',
    '1. `memory_recall` -- Summary-first recall across decisions, sessions, and project events.',
    '2. `memory_calendar` -- Day/week/month activity overview.',
    '3. `memory_project_state` -- Live package/git identity, memory freshness, and open next steps.',
    '4. `memory_search` -- Full-text FTS5 search across files, decisions, and events.',
    '5. `memory_remember` -- Explicitly persist key architectural choices and conventions.',
    '6. `memory_review` / `memory_forget` -- Inspect durable facts and forget outdated entries.',
    '7. `memory_timeline` / `memory_explore` / `memory_scan` / `memory_status` -- Chronology, structure, and diagnostics.',
    '',
    '## Capture Modes & Privacy',
    '',
    '- `metadata`: structural tool/file activity and diagnostics only; no prompt or response text capture.',
    '- `redacted` (default): bounded redacted snippets (up to 600 chars) with secret/denylist filtering.',
    '- `full`: up to 4000 chars of redacted prompt/response text stored locally. Maximum recall carries higher local privacy exposure and is never risk-free.',
    '',
  ].join('\n');
}

export function writeAntigravityPluginBundle(
  options: WriteAntigravityPluginBundleOptions,
): WriteAntigravityPluginBundleResult {
  const pluginDir = options.targetDir;
  const runtimeDir = join(pluginDir, 'runtime');
  const captureLevel = options.captureLevel ?? 'redacted';

  const manifestPath = join(pluginDir, 'plugin.json');
  const hooksPath = join(pluginDir, 'hooks.json');
  const hookRunnerPath = join(pluginDir, 'hooks', 'locus-hook.mjs');
  const mcpPath = join(pluginDir, 'mcp_config.json');
  const rulesPath = join(pluginDir, 'rules', 'AGENTS.md');
  const skillPath = join(pluginDir, 'skills', 'locus-memory', 'SKILL.md');

  const hadAllPluginFiles =
    existsSync(manifestPath) &&
    existsSync(hooksPath) &&
    existsSync(hookRunnerPath) &&
    existsSync(mcpPath) &&
    existsSync(rulesPath) &&
    existsSync(skillPath) &&
    existsSync(join(runtimeDir, 'cli.js')) &&
    existsSync(join(runtimeDir, 'server.js'));

  const runtimeResult = installRuntimeFiles(runtimeDir, {
    startDir: options.startDir,
    sourceDistDir: options.sourceDistDir,
    now: options.now,
  });
  const version = options.version ?? runtimeResult.version;

  const changedFlags = [
    syncTextAtomically(
      manifestPath,
      `${JSON.stringify(buildAntigravityPluginManifest(version), null, 2)}\n`,
    ),
    syncTextAtomically(hooksPath, `${JSON.stringify(buildAntigravityHooksJson(), null, 2)}\n`),
    syncTextAtomically(hookRunnerPath, buildAntigravityHookRunnerScript()),
    syncTextAtomically(
      mcpPath,
      `${JSON.stringify(buildAntigravityMcpConfigJson(captureLevel), null, 2)}\n`,
    ),
    syncTextAtomically(rulesPath, buildAntigravityRulesMarkdown()),
    syncTextAtomically(skillPath, buildAntigravitySkillMarkdown()),
  ];

  const anyChanged = changedFlags.some(Boolean) || runtimeResult.action !== 'unchanged';
  let action: 'installed' | 'updated' | 'unchanged' = 'unchanged';
  if (!hadAllPluginFiles) {
    action = 'installed';
  } else if (anyChanged) {
    action = 'updated';
  }

  return {
    action,
    pluginDir,
    version,
    runtimeDir,
    files: [
      manifestPath,
      hooksPath,
      hookRunnerPath,
      mcpPath,
      rulesPath,
      skillPath,
      runtimeResult.cliPath,
      runtimeResult.serverPath,
      runtimeResult.manifestPath,
      join(runtimeDir, 'package.json'),
    ],
  };
}
