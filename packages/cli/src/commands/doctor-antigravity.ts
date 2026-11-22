import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAntigravityPluginDir } from '../antigravity/paths.js';

export interface DoctorAntigravityOptions {
  env?: Record<string, string | undefined>;
  targetDir?: string;
}

export interface DoctorAntigravityResult {
  exitCode: number;
  output: string;
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatDoctorAntigravity(
  options: DoctorAntigravityOptions = {},
): DoctorAntigravityResult {
  const env = options.env ?? process.env;
  const pluginDir = options.targetDir?.trim() || resolveAntigravityPluginDir(env);
  const issues: string[] = [];

  if (!existsSync(pluginDir)) {
    return {
      exitCode: 1,
      output: [
        'Locus Antigravity doctor',
        `Plugin dir: ${pluginDir}`,
        'Status: missing (run `locus-memory install antigravity --yes`)',
      ].join('\n'),
    };
  }

  const manifest = readJsonRecord(join(pluginDir, 'plugin.json'));
  if (!manifest || manifest.name !== 'locus-memory') {
    issues.push('plugin.json missing or invalid name');
  }

  const hooks = readJsonRecord(join(pluginDir, 'hooks.json'));
  const hookEntry =
    hooks && typeof hooks['locus-memory'] === 'object' && hooks['locus-memory'] !== null
      ? (hooks['locus-memory'] as Record<string, unknown>)
      : undefined;
  const requiredEvents = ['SessionStart', 'PreInvocation', 'PostToolUse', 'Stop'];
  const missingEvents = requiredEvents.filter(
    (eventName) => !Array.isArray(hookEntry?.[eventName]) || hookEntry[eventName].length === 0,
  );
  if (missingEvents.length > 0) {
    issues.push(`hooks.json missing events: ${missingEvents.join(', ')}`);
  }

  if (!existsSync(join(pluginDir, 'hooks', 'locus-hook.mjs'))) {
    issues.push('hooks/locus-hook.mjs missing');
  }

  const mcp = readJsonRecord(join(pluginDir, 'mcp_config.json'));
  const mcpServers =
    mcp && typeof mcp.mcpServers === 'object' && mcp.mcpServers !== null
      ? (mcp.mcpServers as Record<string, unknown>)
      : undefined;
  if (!mcpServers || typeof mcpServers.locus !== 'object' || mcpServers.locus === null) {
    issues.push('mcp_config.json missing mcpServers.locus');
  }

  const rulesPath = join(pluginDir, 'rules', 'AGENTS.md');
  if (!existsSync(rulesPath)) {
    issues.push('rules/AGENTS.md missing');
  } else {
    const rulesText = readFileSync(rulesPath, 'utf8').trimStart();
    if (rulesText.length === 0 || rulesText.startsWith('---')) {
      issues.push('rules/AGENTS.md must be non-empty plain markdown without frontmatter');
    }
  }

  const skillPath = join(pluginDir, 'skills', 'locus-memory', 'SKILL.md');
  if (!existsSync(skillPath) || !readFileSync(skillPath, 'utf8').trimStart().startsWith('---')) {
    issues.push('skills/locus-memory/SKILL.md missing or missing YAML frontmatter');
  }

  const runtimeDir = join(pluginDir, 'runtime');
  for (const runtimeFile of ['cli.js', 'server.js', 'package.json', 'runtime.json']) {
    if (!existsSync(join(runtimeDir, runtimeFile))) {
      issues.push(`runtime/${runtimeFile} missing`);
    }
  }

  const healthy = issues.length === 0;
  const lines = [
    'Locus Antigravity doctor',
    `Node version: ${process.version}`,
    `Plugin dir: ${pluginDir}`,
    `Version: ${typeof manifest?.version === 'string' ? manifest.version : 'unknown'}`,
    `Status: ${healthy ? 'ok' : 'broken'}`,
  ];

  if (!healthy) {
    lines.push(`Issues (${issues.length}):`);
    for (const issue of issues) {
      lines.push(`  - ${issue}`);
    }
  }

  return {
    exitCode: healthy ? 0 : 1,
    output: lines.join('\n'),
  };
}
