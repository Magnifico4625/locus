import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

export type CodexMcpOwnership = 'package-owned' | 'manual-locus' | 'foreign-locus' | 'missing';

export interface CodexMcpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export const defaultCodexMcpEnv = {
  LOCUS_LOG: 'error',
  LOCUS_CODEX_CAPTURE: 'redacted',
  LOCUS_CAPTURE_LEVEL: 'redacted',
} as const;

export function buildMcpServerConfig(options: {
  version: string;
  platform?: NodeJS.Platform;
  cwd?: string;
}): Required<CodexMcpServerConfig> {
  return {
    command: options.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', `locus-memory@${options.version}`, 'mcp'],
    env: { ...defaultCodexMcpEnv },
    cwd: options.cwd ?? '',
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
  const cwdLine = output.match(/^\s*cwd:\s*(.*)$/im)?.[1]?.trim();

  return {
    command,
    args: argsLine ? argsLine.split(/\s+/) : [],
    cwd: cwdLine && cwdLine !== '-' ? cwdLine : undefined,
  };
}

export function quoteTomlBasicString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderMcpTomlBlock(
  name: string,
  config: Required<Omit<CodexMcpServerConfig, 'cwd'>> & { cwd?: string },
): string {
  const lines = [
    `[mcp_servers.${name}]`,
    `command = ${quoteTomlBasicString(config.command)}`,
    `args = [${config.args.map(quoteTomlBasicString).join(', ')}]`,
  ];

  if (config.cwd) {
    lines.push(`cwd = ${quoteTomlBasicString(config.cwd)}`);
  }

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

export function setMcpServerCwd(
  configPath: string,
  name: string,
  cwd: string,
  now = new Date(),
): { action: 'updated' | 'missing'; backupPath?: string } {
  const text = readFileSync(configPath, 'utf8');
  const headerPattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$`, 'm');
  const headerMatch = headerPattern.exec(text);

  if (!headerMatch) {
    return { action: 'missing' };
  }

  const sectionStart = headerMatch.index;
  const afterHeader = sectionStart + headerMatch[0].length;
  const nextSectionMatch = /^\[/m.exec(text.slice(afterHeader));
  const sectionEnd = nextSectionMatch ? afterHeader + nextSectionMatch.index : text.length;
  const before = text.slice(0, sectionStart);
  const section = text.slice(sectionStart, sectionEnd);
  const after = text.slice(sectionEnd);
  const cwdLine = `cwd = ${quoteTomlBasicString(cwd)}`;
  const backupPath = createConfigBackup(configPath, now);

  let updatedSection: string;
  if (/^cwd\s*=/m.test(section)) {
    updatedSection = section.replace(/^cwd\s*=.*$/m, cwdLine);
  } else if (/^args\s*=/m.test(section)) {
    updatedSection = section.replace(/^(args\s*=.*)$/m, `$1\n${cwdLine}`);
  } else {
    updatedSection = section.replace(/^(\[mcp_servers\.[^\]]+\])\s*$/m, `$1\n${cwdLine}`);
  }

  writeFileSync(configPath, `${before}${updatedSection}${after}`, 'utf8');
  return { action: 'updated', backupPath };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
}
