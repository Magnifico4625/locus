import { buildRuntimePackageSpecifier } from '../package-info.js';

export type CodexHookConfigEvent = 'SessionStart' | 'UserPromptSubmit' | 'Stop';
export type CodexHookCommandEvent = 'session-start' | 'user-prompt-submit' | 'stop';

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
  hooks: Partial<Record<CodexHookConfigEvent | 'PostToolUse', CodexHookMatcherGroup[]>>;
}

export interface BuildCodexHooksConfigOptions {
  version: string;
  platform?: NodeJS.Platform;
  timeoutSeconds?: number;
  binaryPath?: string;
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
    configEvent: 'Stop',
    commandEvent: 'stop',
    statusMessage: 'Notifying Locus that the turn stopped',
  },
];

export function buildCodexHooksConfig(options: BuildCodexHooksConfigOptions): CodexHooksConfig {
  const timeout = options.timeoutSeconds ?? 3;
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
}): string {
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
