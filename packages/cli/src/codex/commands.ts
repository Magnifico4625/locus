import { defaultCodexMcpEnv } from './config.js';

export interface CodexMcpCommandOptions {
  name: string;
  version: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string>;
}

export function detectNpxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function buildCodexMcpAddArgs(options: CodexMcpCommandOptions): string[] {
  const env = options.env ?? defaultCodexMcpEnv;
  const args = ['mcp', 'add'];

  for (const [key, value] of Object.entries(env)) {
    args.push('--env', `${key}=${value}`);
  }

  args.push(
    options.name,
    '--',
    detectNpxCommand(options.platform),
    '-y',
    `locus-memory@${options.version}`,
    'mcp',
  );

  return args;
}

export function buildCodexMcpRemoveArgs(name: string): string[] {
  return ['mcp', 'remove', name];
}
