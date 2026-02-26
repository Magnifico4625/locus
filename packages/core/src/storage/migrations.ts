import type { DatabaseAdapter } from '../types.js';

function getCurrentVersion(db: DatabaseAdapter): number {
  try {
    const row = db.get<{ version: number }>('SELECT version FROM schema_version');
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

function migrationV1(db: DatabaseAdapter, fts5: boolean): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS files (
    relative_path TEXT PRIMARY KEY,
    exports_json TEXT,
    imports_json TEXT,
    re_exports_json TEXT,
    file_type TEXT,
    language TEXT,
    lines INTEGER,
    confidence_level TEXT,
    confidence_reason TEXT,
    last_scanned INTEGER,
    skipped_reason TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    layer TEXT NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    session_id TEXT
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS hook_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT,
    file_paths_json TEXT,
    status TEXT,
    exit_code INTEGER,
    timestamp INTEGER,
    duration_ms INTEGER,
    diff_added INTEGER,
    diff_removed INTEGER,
    error_kind TEXT,
    bash_command TEXT
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_hook_captures_timestamp ON hook_captures(timestamp)');

  db.exec(`CREATE TABLE IF NOT EXISTS scan_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id
    )`);
  }

  db.run('INSERT INTO schema_version (version) VALUES (?)', [1]);
}

export function runMigrations(db: DatabaseAdapter, fts5: boolean): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion < 1) {
    migrationV1(db, fts5);
  }
}
