export function resolveLocusHome(env?: Record<string, string | undefined>): string;
export function resolveRuntimeBinDir(env?: Record<string, string | undefined>): string;
export function resolveStorageRoot(): string;
export function resolveProjectStorageDir(projectRoot: string): string;
export function resolveDbPath(projectRoot: string): string;
export function resolveInboxDir(projectRoot: string): string;
export function resolveLogPath(): string;
