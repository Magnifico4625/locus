import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'error' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = { error: 0, info: 1, debug: 2 };
const MAX_ROTATED = 3;

// ─── Backward-compatible global logger (used by server.ts) ───

let currentLevel: LogLevel = 'error';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function log(level: LogLevel, message: string): void {
  if (LEVELS[level] <= LEVELS[currentLevel]) {
    process.stderr.write(`[locus:${level}] ${message}\n`);
  }
}

// ─── File-based rotating logger ───

export interface Logger {
  error(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  close(): void;
}

export function createLogger(logPath: string, level: LogLevel, maxSize = 1_048_576): Logger {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  function shouldLog(msgLevel: LogLevel): boolean {
    return LEVELS[msgLevel] <= LEVELS[level];
  }

  function rotate(): void {
    const oldest = `${logPath}.${MAX_ROTATED}`;
    if (existsSync(oldest)) {
      unlinkSync(oldest);
    }

    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const from = `${logPath}.${i}`;
      const to = `${logPath}.${i + 1}`;
      if (existsSync(from)) {
        renameSync(from, to);
      }
    }

    if (existsSync(logPath)) {
      renameSync(logPath, `${logPath}.1`);
    }
  }

  function write(msgLevel: LogLevel, message: string): void {
    if (!shouldLog(msgLevel)) return;

    const line = `${new Date().toISOString()} [${msgLevel}] ${message}\n`;
    appendFileSync(logPath, line);

    try {
      const stats = statSync(logPath);
      if (stats.size > maxSize) {
        rotate();
      }
    } catch {
      // File may not be accessible — ignore
    }
  }

  return {
    error: (msg: string) => write('error', msg),
    info: (msg: string) => write('info', msg),
    debug: (msg: string) => write('debug', msg),
    close: () => {
      // Sync writes — nothing to flush
    },
  };
}

// ─── Path masking (Contract 3: content-free logging) ───

export function maskPath(filePath: string, enabled: boolean): string {
  if (!enabled) return filePath;

  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return filePath;

  return `****/${parts.slice(-3).join('/')}`;
}
