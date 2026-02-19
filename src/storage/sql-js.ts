import { writeFileSync } from 'node:fs';
import type { DatabaseAdapter, RunResult } from '../types.js';

interface SqlJsDatabase {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatement {
  bind(params?: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

const SAVE_DEBOUNCE_MS = 5000;

export class SqlJsAdapter implements DatabaseAdapter {
  private readonly db: SqlJsDatabase;
  private readonly dbPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.scheduleSave();
  }

  run(sql: string, params?: unknown[]): RunResult {
    if (params && params.length > 0) {
      this.db.run(sql, params);
    } else {
      this.db.run(sql);
    }
    const changes = this.db.getRowsModified();
    const lidStmt = this.db.prepare('SELECT last_insert_rowid() AS lid');
    let lastInsertRowid = 0;
    if (lidStmt.step()) {
      const row = lidStmt.getAsObject();
      lastInsertRowid = Number(row.lid ?? 0);
    }
    lidStmt.free();
    this.scheduleSave();
    return { changes, lastInsertRowid };
  }

  get<T>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const hasRow = stmt.step();
    if (!hasRow) {
      stmt.free();
      return undefined;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return row as T;
  }

  all<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
    this.db.close();
  }

  private saveToDisk(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }
}
