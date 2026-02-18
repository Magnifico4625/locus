export type LogLevel = 'error' | 'info' | 'debug';

let currentLevel: LogLevel = 'error';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

const LEVELS: Record<LogLevel, number> = { error: 0, info: 1, debug: 2 };

export function log(level: LogLevel, message: string): void {
  if (LEVELS[level] <= LEVELS[currentLevel]) {
    // TODO: write to file instead of stderr
    process.stderr.write(`[locus:${level}] ${message}\n`);
  }
}
