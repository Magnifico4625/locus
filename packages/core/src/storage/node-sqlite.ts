import type { DatabaseAdapter, RunResult } from '../types.js';

interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

const BUSY_RETRY_DELAYS_MS = [25, 50, 100] as const;

function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked/i.test(message);
}

function sleepSync(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

export class NodeSqliteAdapter implements DatabaseAdapter {
  private readonly db: NodeSqliteDb;

  constructor(db: NodeSqliteDb) {
    this.db = db;
  }

  private withBusyRetry<T>(fn: () => T): T {
    for (let attempt = 0; ; attempt++) {
      try {
        return fn();
      } catch (error) {
        const delayMs = BUSY_RETRY_DELAYS_MS[attempt];
        if (delayMs === undefined || !isBusyError(error)) {
          throw error;
        }
        sleepSync(delayMs);
      }
    }
  }

  exec(sql: string): void {
    this.withBusyRetry(() => this.db.exec(sql));
  }

  run(sql: string, params?: unknown[]): RunResult {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return {
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    });
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const row = params ? stmt.get(...params) : stmt.get();
      return row as T | undefined;
    });
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const rows = params ? stmt.all(...params) : stmt.all();
      return rows as T[];
    });
  }

  close(): void {
    this.db.close();
  }
}
