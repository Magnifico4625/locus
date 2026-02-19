import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseAdapter } from '../types.js';
import { runMigrations } from './migrations.js';
import { NodeSqliteAdapter } from './node-sqlite.js';
import { SqlJsAdapter } from './sql-js.js';

export interface StorageInit {
  db: DatabaseAdapter;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
}

// Minimal interface for node:sqlite's DatabaseSync that matches what NodeSqliteAdapter expects.
// node:sqlite returns number|bigint for changes/lastInsertRowid; we cast to satisfy our adapter.
interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  close(): void;
}

export function detectFts5(db: DatabaseAdapter): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE _fts5_test USING fts5(c)');
    db.exec('DROP TABLE _fts5_test');
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dbPath: string): void {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function initStorage(dbPath: string): Promise<StorageInit> {
  ensureDir(dbPath);

  // 1. Try node:sqlite (Node 22+)
  try {
    const nodeSqlite = await import('node:sqlite');
    // Cast through unknown: DatabaseSync returns number|bigint for changes,
    // but NodeSqliteAdapter's private interface expects number. Safe at runtime.
    const raw = new nodeSqlite.DatabaseSync(dbPath) as unknown as NodeSqliteDb;
    const db = new NodeSqliteAdapter(raw);
    const fts5 = detectFts5(db);
    runMigrations(db, fts5);
    return { db, backend: 'node:sqlite', fts5 };
  } catch {
    // node:sqlite not available (Node <22)
  }

  // 2. Fallback to sql.js (vendor types in src/vendor.d.ts)
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();

  let sqlDb: InstanceType<typeof SQL.Database>;
  if (existsSync(dbPath)) {
    const fileData = readFileSync(dbPath);
    sqlDb = new SQL.Database(new Uint8Array(fileData));
  } else {
    sqlDb = new SQL.Database();
  }

  const db = new SqlJsAdapter(sqlDb, dbPath);
  const fts5 = detectFts5(db);
  runMigrations(db, fts5);
  return { db, backend: 'sql.js', fts5 };
}
