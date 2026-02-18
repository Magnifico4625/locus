import type { DatabaseAdapter, RunResult } from '../types.js';

export class NodeSqliteAdapter implements DatabaseAdapter {
  exec(_sql: string): void {
    /* TODO */
  }
  run(_sql: string, _params?: unknown[]): RunResult {
    return { changes: 0, lastInsertRowid: 0 };
  }
  get<T>(_sql: string, _params?: unknown[]): T | undefined {
    return undefined;
  }
  all<T>(_sql: string, _params?: unknown[]): T[] {
    return [];
  }
  close(): void {
    /* TODO */
  }
}
