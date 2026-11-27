import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureLevel } from '@locus/core';
import {
  installRuntimeFiles,
  resolveDefaultSourceDistDir,
  syncFileAtomically,
  syncTextAtomically,
  writeFileAtomically,
} from '../runtime-install.js';
import { DSH_PLUGIN_PACKAGE_NAME } from './paths.js';

export interface WriteDshPluginBundleOptions {
  targetDir: string;
  version?: string;
  startDir?: string;
  sourceDistDir?: string;
  captureLevel?: CaptureLevel;
  enableMcp?: boolean;
  now?: Date;
}

export interface WriteDshPluginBundleResult {
  action: 'installed' | 'updated' | 'unchanged';
  pluginDir: string;
  version: string;
  runtimeDir: string;
  files: string[];
}

interface DshRuntimeManifest {
  version: string;
  installedAt: string;
  cliPath: string;
  pluginPath: string;
  serverPath: string;
}

function readExistingPluginPath(manifestPath: string): string | undefined {
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { pluginPath?: unknown };
    return typeof parsed.pluginPath === 'string' ? parsed.pluginPath : undefined;
  } catch {
    return undefined;
  }
}

const BUNDLED_SKILL_DIR_JS =
  "!!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('locus-memory-dsh/package.json')), 'skills')";

export function buildDshPluginPackageJson(version: string): Record<string, unknown> {
  return {
    name: DSH_PLUGIN_PACKAGE_NAME,
    version,
    description:
      'Persistent project-aware memory for DeepSeek Harness Desktop with zero-call context injection, real-time capture, daily journal, and local SQLite MCP recall.',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './package.json': './package.json',
    },
    files: ['lib', 'runtime', 'skills', 'cordis.patch.yml', 'package.json'],
    keywords: ['dsh-plugin', 'deepseek-harness', 'cordis', 'agent-skill', 'memory', 'mcp'],
    engines: {
      node: '>=22.0.0',
    },
    license: 'MIT',
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
      },
    },
  };
}

export function buildDshCordisPatchYaml(
  options: { captureLevel?: CaptureLevel; enableMcp?: boolean } = {},
): string {
  const captureLevel = options.captureLevel ?? 'redacted';
  const enableMcp = options.enableMcp !== false;

  return [
    '- insert:',
    '    - id: locus-memory',
    `      name: ${DSH_PLUGIN_PACKAGE_NAME}`,
    '      config:',
    `        captureLevel: ${captureLevel}`,
    `        enableMcp: ${enableMcp ? 'true' : 'false'}`,
    '    - id: locus-memory-skill',
    "      name: '@deepseek-ai/dsh-skill-filesystem'",
    '      config:',
    '        providerName: locus-memory',
    '        includeDefaultRoots: false',
    `        bundledSkillDir: ${BUNDLED_SKILL_DIR_JS}`,
    '',
  ].join('\n');
}

export function buildDshSkillMarkdown(): string {
  return [
    '---',
    'name: locus-memory',
    'description: >',
    '  Persistent local SQLite project memory for DeepSeek Harness Desktop. Zero-call Cordis',
    '  hooks inject bounded project briefs and prompt recall automatically before turns; invoke',
    '  deep MCP tools for date queries, saving decisions, project state, and memory cleanup.',
    '---',
    '',
    '# Locus Memory (DeepSeek Harness Desktop)',
    '',
    'Locus stores workspace-scoped persistent memory locally in SQLite with secret redaction, FTS5 search, and a daily chronological journal (`journal/YYYY-MM-DD.md` + `INDEX.md`).',
    '',
    '## Zero-Call Cordis Lifecycle',
    '',
    '- **Pre-step context (`agent/pre-step`)**: injects `[Locus Memory — Project Brief]` (project state, active decisions, constraints, recent files, `Recent Days:`) and `[Locus Memory — Relevant Recall]` automatically as `<system-reminder>` context.',
    '- **Real-time capture (`session/event`, `tools/result`)**: captures verified human prompts, assistant text responses (excluding reasoning traces), and mutating/failing tool executions into the local project inbox.',
    '- **Turn end flush (`turn/end`)**: processes inbox events, extracts durable decisions/constraints, updates daily summaries, and closes the SQLite handle cleanly.',
    '',
    '## Deep MCP Tools (`locus` server)',
    '',
    '1. `memory_recall` -- Summary-first recall across decisions, sessions, and project events.',
    '2. `memory_calendar` -- Day/week/month activity buckets with `summaryPreview`.',
    '3. `memory_project_state` -- Live package/git identity, memory freshness, and open next steps.',
    '4. `memory_search` -- Full-text FTS5 search across files, decisions, and events.',
    '5. `memory_remember` -- Explicitly persist key architectural choices and conventions.',
    '6. `memory_review` / `memory_forget` -- Inspect durable facts and forget outdated entries.',
    '7. `memory_timeline` / `memory_explore` / `memory_scan` / `memory_status` / `memory_compact` -- Chronology, structure, diagnostics, and raw tool-use compaction.',
    '',
    '## Capture Modes & Privacy',
    '',
    '- `metadata`: structural tool/file activity and diagnostics only; no prompt or response text capture.',
    '- `redacted` (default): bounded redacted snippets (up to 600 chars) with secret/denylist filtering.',
    '- `full`: up to 4000 chars of redacted prompt/response text stored locally. Maximum recall carries higher local privacy exposure and is never risk-free.',
    '',
  ].join('\n');
}

export function writeDshPluginBundle(
  options: WriteDshPluginBundleOptions,
): WriteDshPluginBundleResult {
  const pluginDir = options.targetDir;
  const runtimeDir = join(pluginDir, 'runtime');
  const captureLevel = options.captureLevel ?? 'redacted';
  const enableMcp = options.enableMcp !== false;

  const sourceDistDir = options.sourceDistDir ?? resolveDefaultSourceDistDir(options.startDir);
  const sourcePluginPath = join(sourceDistDir, 'dsh-plugin.js');
  const sourceServerPath = join(sourceDistDir, 'server.js');
  const sourceCliPath = join(sourceDistDir, 'cli.js');

  if (
    !existsSync(sourcePluginPath) ||
    !existsSync(sourceServerPath) ||
    !existsSync(sourceCliPath)
  ) {
    throw new Error(
      `Missing built DSH runtime artifacts in ${sourceDistDir} (expected cli.js, server.js, and dsh-plugin.js). Run npm run build first.`,
    );
  }

  const packageJsonPath = join(pluginDir, 'package.json');
  const patchPath = join(pluginDir, 'cordis.patch.yml');
  const entryPath = join(pluginDir, 'lib', 'index.js');
  const skillPath = join(pluginDir, 'skills', 'locus-memory', 'SKILL.md');
  const runtimeServerPath = join(runtimeDir, 'server.js');
  const runtimePackagePath = join(runtimeDir, 'package.json');
  const runtimeManifestPath = join(runtimeDir, 'runtime.json');

  const hadAllPluginFiles =
    existsSync(packageJsonPath) &&
    existsSync(patchPath) &&
    existsSync(entryPath) &&
    existsSync(skillPath) &&
    existsSync(runtimeServerPath) &&
    existsSync(runtimePackagePath) &&
    existsSync(runtimeManifestPath);

  const existingPluginPath = readExistingPluginPath(runtimeManifestPath);
  const installedRuntime = installRuntimeFiles(runtimeDir, {
    startDir: options.startDir,
    sourceDistDir,
    now: options.now,
  });
  const version = options.version ?? installedRuntime.version;
  const pluginChanged = syncFileAtomically(sourcePluginPath, entryPath);
  const manifestNeedsUpdate =
    pluginChanged || installedRuntime.action !== 'unchanged' || existingPluginPath !== entryPath;

  const dshRuntimeManifest: DshRuntimeManifest = {
    version,
    installedAt: (options.now ?? new Date()).toISOString(),
    cliPath: installedRuntime.cliPath,
    pluginPath: entryPath,
    serverPath: runtimeServerPath,
  };
  if (manifestNeedsUpdate) {
    writeFileAtomically(runtimeManifestPath, `${JSON.stringify(dshRuntimeManifest, null, 2)}\n`);
  }

  const changedFlags = [
    syncTextAtomically(
      packageJsonPath,
      `${JSON.stringify(buildDshPluginPackageJson(version), null, 2)}\n`,
    ),
    syncTextAtomically(patchPath, buildDshCordisPatchYaml({ captureLevel, enableMcp })),
    syncTextAtomically(skillPath, buildDshSkillMarkdown()),
    pluginChanged,
    manifestNeedsUpdate,
  ];

  const anyChanged = changedFlags.some(Boolean) || installedRuntime.action !== 'unchanged';
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
      packageJsonPath,
      patchPath,
      entryPath,
      skillPath,
      runtimeServerPath,
      runtimePackagePath,
      runtimeManifestPath,
    ],
  };
}
