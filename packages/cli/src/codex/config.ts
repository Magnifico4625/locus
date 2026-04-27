import { copyFileSync } from 'node:fs';

export type CodexMcpOwnership = 'package-owned' | 'manual-locus' | 'foreign-locus' | 'missing';

export interface CodexMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export const defaultCodexMcpEnv = {
  LOCUS_LOG: 'error',
  LOCUS_CODEX_CAPTURE: 'redacted',
  LOCUS_CAPTURE_LEVEL: 'redacted',
} as const;

export function buildMcpServerConfig(options: {
  version: string;
  platform?: NodeJS.Platform;
}): Required<CodexMcpServerConfig> {
  return {
    command: options.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', `locus-memory@${options.version}`, 'mcp'],
    env: { ...defaultCodexMcpEnv },
  };
}

export function classifyMcpOwnership(config?: CodexMcpServerConfig): CodexMcpOwnership {
  if (!config) {
    return 'missing';
  }

  const command = config.command ?? '';
  const args = config.args ?? [];
  const joinedArgs = args.join(' ');

  if (/^npx(?:\.cmd)?$/i.test(command) && args.some((arg) => /^locus-memory@/.test(arg))) {
    return 'package-owned';
  }

  if (command === 'node' && /dist[\\/]+server\.js/i.test(joinedArgs)) {
    return 'manual-locus';
  }

  return 'foreign-locus';
}

export function parseCodexMcpGetOutput(output: string): CodexMcpServerConfig | undefined {
  if (!output.trim()) {
    return undefined;
  }

  const command = output.match(/^\s*command:\s*(.+)$/im)?.[1]?.trim();
  const argsLine = output.match(/^\s*args:\s*(.*)$/im)?.[1]?.trim();

  return {
    command,
    args: argsLine ? argsLine.split(/\s+/) : [],
  };
}

export function quoteTomlBasicString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderMcpTomlBlock(name: string, config: Required<CodexMcpServerConfig>): string {
  const lines = [
    `[mcp_servers.${name}]`,
    `command = ${quoteTomlBasicString(config.command)}`,
    `args = [${config.args.map(quoteTomlBasicString).join(', ')}]`,
  ];

  if (Object.keys(config.env).length > 0) {
    lines.push('[mcp_servers.locus.env]');
    for (const [key, value] of Object.entries(config.env)) {
      lines.push(`${key} = ${quoteTomlBasicString(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function createConfigBackup(configPath: string, now = new Date()): string {
  const backupPath = `${configPath}.${timestamp(now)}.bak`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
}
