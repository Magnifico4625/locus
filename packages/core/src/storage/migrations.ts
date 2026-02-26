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

function migrationV2(db: DatabaseAdapter, fts5: boolean): void {
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT,
    project_root TEXT NOT NULL,
    session_id TEXT,
    timestamp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT,
    significance TEXT,
    tags_json TEXT,
    created_at INTEGER NOT NULL
  )`);

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_event_id ON conversation_events(event_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ce_timestamp ON conversation_events(timestamp)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ce_kind ON conversation_events(kind)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ce_session ON conversation_events(session_id)',
  );

  db.exec(`CREATE TABLE IF NOT EXISTS event_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES conversation_events(event_id)
  )`);

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ef_file_path ON event_files(file_path)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ef_event_id ON event_files(event_id)',
  );

  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      content,
      content=conversation_events,
      content_rowid=id
    )`);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT,
    processed_at INTEGER NOT NULL
  )`);

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_il_event_id ON ingest_log(event_id)',
  );
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_il_source ON ingest_log(source, source_event_id)',
  );

  db.run('UPDATE schema_version SET version = ?', [2]);
}

export function runMigrations(db: DatabaseAdapter, fts5: boolean): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion < 1) {
    migrationV1(db, fts5);
  }

  if (currentVersion < 2) {
    migrationV2(db, fts5);
  }
}
