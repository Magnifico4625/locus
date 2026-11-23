import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { buildRuntimePackageSpecifier } from '../package-info.js';
import { resolveCodexHome } from './paths.js';

export type CodexHookConfigEvent = 'SessionStart' | 'UserPromptSubmit' | 'PostToolUse' | 'Stop';
export type CodexHookCommandEvent =
  | 'session-start'
  | 'user-prompt-submit'
  | 'post-tool-use'
  | 'stop';

export interface CodexHookHandler {
  type: 'command';
  command: string;
  timeout: number;
  statusMessage?: string;
}

export interface CodexHookMatcherGroup {
  matcher?: string;
  hooks: CodexHookHandler[];
}

export interface CodexHooksConfig {
  hooks: Partial<Record<CodexHookConfigEvent, CodexHookMatcherGroup[]>>;
}

export interface BuildCodexHooksConfigOptions {
  version: string;
  platform?: NodeJS.Platform;
  timeoutSeconds?: number;
  binaryPath?: string;
  runtimeCliPath?: string;
}

export type CodexHooksInstallAction = 'created' | 'updated' | 'unchanged';
export type CodexHooksStatus = 'configured' | 'not configured';

export interface InstallCodexHooksResult {
  action: CodexHooksInstallAction;
  path: string;
  backupPath?: string;
}

const hookEvents: ReadonlyArray<{
  configEvent: CodexHookConfigEvent;
  commandEvent: CodexHookCommandEvent;
  matcher?: string;
  statusMessage: string;
}> = [
  {
    configEvent: 'SessionStart',
    commandEvent: 'session-start',
    matcher: 'startup|resume|clear',
    statusMessage: 'Preparing Locus recall freshness',
  },
  {
    configEvent: 'UserPromptSubmit',
    commandEvent: 'user-prompt-submit',
    statusMessage: 'Notifying Locus about a new prompt',
  },
  {
    configEvent: 'PostToolUse',
    commandEvent: 'post-tool-use',
    matcher: 'Bash|Write|Edit|apply_patch|shell|exec_command|run_terminal_command',
    statusMessage: 'Recording Locus tool activity',
  },
  {
    configEvent: 'Stop',
    commandEvent: 'stop',
    statusMessage: 'Notifying Locus that the turn stopped',
  },
];

export function buildCodexHooksConfig(options: BuildCodexHooksConfigOptions): CodexHooksConfig {
  const timeout = options.timeoutSeconds ?? (options.runtimeCliPath ? 10 : 3);
  const hooks: CodexHooksConfig['hooks'] = {};

  for (const event of hookEvents) {
    hooks[event.configEvent] = [
      {
        ...(event.matcher ? { matcher: event.matcher } : {}),
        hooks: [
          {
            type: 'command',
            command: buildCodexHookCommand({
              event: event.commandEvent,
              version: options.version,
              platform: options.platform,
              binaryPath: options.binaryPath,
              runtimeCliPath: options.runtimeCliPath,
            }),
            timeout,
            statusMessage: event.statusMessage,
          },
        ],
      },
    ];
  }

  return { hooks };
}

export function buildCodexHookCommand(options: {
  event: CodexHookCommandEvent;
  version?: string;
  platform?: NodeJS.Platform;
  binaryPath?: string;
  runtimeCliPath?: string;
}): string {
  if (options.runtimeCliPath) {
    return ['node', options.runtimeCliPath, 'hook', 'codex', options.event]
      .map(quoteShellArg)
      .join(' ');
  }

  const command = options.binaryPath ?? (options.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = options.binaryPath
    ? ['hook', 'codex', options.event]
    : [
        '-y',
        buildRuntimePackageSpecifier(requiredVersion(options.version)),
        'hook',
        'codex',
        options.event,
      ];

  return [command, ...args].map(quoteShellArg).join(' ');
}

export function renderCodexHooksJson(config: CodexHooksConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function resolveCodexHooksPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(resolveCodexHome(env), 'hooks.json');
}

export function installCodexHooks(options: {
  env?: Record<string, string | undefined>;
  version: string;
  platform?: NodeJS.Platform;
  runtimeCliPath?: string;
  now?: Date;
}): InstallCodexHooksResult {
  const hooksPath = resolveCodexHooksPath(options.env);
  const next = renderCodexHooksJson(
    buildCodexHooksConfig({
      version: options.version,
      platform: options.platform,
      runtimeCliPath: options.runtimeCliPath,
    }),
  );

  if (existsSync(hooksPath)) {
    const current = readFileSync(hooksPath, 'utf8');
    if (current === next) {
      return { action: 'unchanged', path: hooksPath };
    }

    const backupPath = `${hooksPath}.${timestamp(options.now ?? new Date())}.bak`;
    copyFileSync(hooksPath, backupPath);
    writeHooksFileAtomically(hooksPath, next);
    return { action: 'updated', path: hooksPath, backupPath };
  }

  writeHooksFileAtomically(hooksPath, next);
  return { action: 'created', path: hooksPath };
}

export function inspectCodexHooks(options: { env?: Record<string, string | undefined> } = {}): {
  status: CodexHooksStatus;
  path: string;
} {
  const hooksPath = resolveCodexHooksPath(options.env);
  if (!existsSync(hooksPath)) {
    return { status: 'not configured', path: hooksPath };
  }

  const text = readFileSync(hooksPath, 'utf8');
  return {
    status: hasLocusHookCommand(text) ? 'configured' : 'not configured',
    path: hooksPath,
  };
}

function requiredVersion(version: string | undefined): string {
  if (!version || version.trim().length === 0) {
    throw new Error('Codex hook config requires a pinned locus-memory version');
  }
  return version;
}

function quoteShellArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '\\"')}"`;
}

function hasLocusHookCommand(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      return false;
    }

    return Object.values(parsed.hooks).some((groups) => {
      if (!Array.isArray(groups)) {
        return false;
      }

      return groups.some((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return false;
        }

        return group.hooks.some((handler) => {
          if (!isRecord(handler) || handler.type !== 'command') {
            return false;
          }

          return isLocusHookCommand(handler.command);
        });
      });
    });
  } catch {
    return false;
  }
}

function isLocusHookCommand(command: unknown): boolean {
  if (typeof command !== 'string' || !/\bhook codex\b/u.test(command)) {
    return false;
  }

  return (
    /\blocus-memory(?:\.cmd)?(?:@[\w.-]+)?\b/u.test(command) ||
    /\bnode\b.*\bcli\.js\b/u.test(command)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function writeHooksFileAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.locus-tmp`;
  writeFileSync(tempPath, text, 'utf8');
  // Rename is atomic on the same filesystem and prevents partial hooks.json reads.
  renameSync(tempPath, path);
}

function timestamp(date: Date): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
}
