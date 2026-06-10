import { defaultCodexMcpEnv } from './config.js';

export interface CodexMcpCommandOptions {
  name: string;
  version: string;
  runtimePackage?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string>;
}

export function detectNpxCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function detectNpmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function buildCodexMcpRuntimeCommand(options: {
  version: string;
  runtimePackage?: string;
  platform?: NodeJS.Platform;
}): { command: string; args: string[] } {
  if (options.runtimePackage) {
    return {
      command: detectNpmCommand(options.platform),
      args: ['exec', '--yes', '--package', options.runtimePackage, '--', 'locus-memory', 'mcp'],
    };
  }

  return {
    command: detectNpxCommand(options.platform),
    args: ['-y', `locus-memory@${options.version}`, 'mcp'],
  };
}

export function buildCodexMcpAddArgs(options: CodexMcpCommandOptions): string[] {
  const env = options.env ?? defaultCodexMcpEnv;
  const runtime = buildCodexMcpRuntimeCommand(options);
  const args = ['mcp', 'add'];

  for (const [key, value] of Object.entries(env)) {
    args.push('--env', `${key}=${value}`);
  }

  args.push(options.name, '--', runtime.command, ...runtime.args);

  return args;
}

export function buildCodexMcpRemoveArgs(name: string): string[] {
  return ['mcp', 'remove', name];
}
