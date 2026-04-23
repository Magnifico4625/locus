import type { DatabaseAdapter } from '../types.js';

function getCurrentVersion(db: DatabaseAdapter): number {
  try {
    const row = db.get<{ version: number }>('SELECT version FROM schema_version');
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

function tableExists(db: DatabaseAdapter, name: string): boolean {
  const row = db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  );
  return (row?.cnt ?? 0) > 0;
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

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_event_id ON conversation_events(event_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_timestamp ON conversation_events(timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_kind ON conversation_events(kind)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_session ON conversation_events(session_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS event_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES conversation_events(event_id)
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_ef_file_path ON event_files(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ef_event_id ON event_files(event_id)');

  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      content
    )`);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT,
    processed_at INTEGER NOT NULL
  )`);

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_il_event_id ON ingest_log(event_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_il_source ON ingest_log(source, source_event_id)');

  db.run('UPDATE schema_version SET version = ?', [2]);
}

function migrationV3(db: DatabaseAdapter, fts5: boolean): void {
  db.exec(`CREATE TABLE IF NOT EXISTS durable_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_key TEXT,
    memory_type TEXT NOT NULL,
    state TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    source_event_id TEXT,
    source TEXT NOT NULL,
    superseded_by_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_dm_topic_key ON durable_memories(topic_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dm_state ON durable_memories(state)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dm_source_event_id ON durable_memories(source_event_id)');

  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS durable_memories_fts USING fts5(
      summary,
      content=durable_memories,
      content_rowid=id
    )`);
  }

  db.run('UPDATE schema_version SET version = ?', [3]);
}

// ─── FTS repair ──────────────────────────────────────────────────────────────

interface ConversationRow {
  id: number;
  kind: string;
  payload_json: string | null;
}

/**
 * Extracts searchable text from a conversation_events row for FTS indexing.
 * Simplified version of pipeline's extractFtsContent, adapted for DB row format.
 * payload_json is already redacted during ingest, so no extra redaction needed.
 */
function extractFtsFromRow(kind: string, payloadJson: string | null): string {
  const parts: string[] = [kind];
  if (!payloadJson) return parts.join(' ');

  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload.prompt === 'string' && payload.prompt) parts.push(payload.prompt);
    if (typeof payload.response === 'string' && payload.response) parts.push(payload.response);
    if (typeof payload.tool === 'string' && payload.tool) parts.push(payload.tool);
    if (typeof payload.command === 'string' && payload.command) parts.push(payload.command);
    if (typeof payload.path === 'string' && payload.path) parts.push(payload.path);
    if (typeof payload.summary === 'string' && payload.summary) parts.push(payload.summary);
    if (Array.isArray(payload.files)) {
      for (const f of payload.files) {
        if (typeof f === 'string') parts.push(f);
      }
    }
  } catch {
    // Ignore malformed JSON
  }

  return parts.join(' ');
}

function rebuildConversationFts(db: DatabaseAdapter): void {
  const rows = db.all<ConversationRow>('SELECT id, kind, payload_json FROM conversation_events');
  for (const row of rows) {
    const content = extractFtsFromRow(row.kind, row.payload_json);
    if (content.length > row.kind.length) {
      try {
        db.run('INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)', [row.id, content]);
      } catch {
        // Skip duplicates or other FTS errors
      }
    }
  }
}

/**
 * Ensures FTS5 virtual tables exist and are populated.
 * Fixes the "migration gap" where DB was created without FTS5 and later
 * opened with FTS5 available — versioned migrations don't re-run, so
 * FTS tables are never created.
 *
 * Also handles the case where FTS tables exist but index is empty
 * (e.g., memories added when fts5=false, or index corruption).
 */
export function ensureFts(db: DatabaseAdapter, fts5: boolean): void {
  if (!fts5) return;

  // 1. Ensure memories_fts exists and is populated
  if (!tableExists(db, 'memories_fts')) {
    db.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id
    )`);
  }
  // Always rebuild: memories_fts is an external content table, so
  // SELECT COUNT(*) reads from the content table (memories), not the FTS index.
  // We can't detect an empty index without querying shadow tables.
  // Rebuild is idempotent and O(N) where N = number of memories (typically <100).
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')");

  // 2. Ensure conversation_fts exists and is populated
  if (!tableExists(db, 'conversation_fts')) {
    db.exec('CREATE VIRTUAL TABLE conversation_fts USING fts5(content)');
    rebuildConversationFts(db);
  } else {
    // Check if index is empty while events exist
    const ceCount =
      db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_events')?.cnt ?? 0;
    const cftsCount =
      db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_fts')?.cnt ?? 0;
    if (ceCount > 0 && cftsCount === 0) {
      rebuildConversationFts(db);
    }
  }

  // 3. Ensure durable_memories_fts exists and is populated
  if (!tableExists(db, 'durable_memories_fts')) {
    db.exec(`CREATE VIRTUAL TABLE durable_memories_fts USING fts5(
      summary,
      content=durable_memories,
      content_rowid=id
    )`);
  }
  db.exec("INSERT INTO durable_memories_fts(durable_memories_fts) VALUES ('rebuild')");
}

export function runMigrations(db: DatabaseAdapter, fts5: boolean): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion < 1) {
    migrationV1(db, fts5);
  }

  if (currentVersion < 2) {
    migrationV2(db, fts5);
  }

  if (currentVersion < 3) {
    migrationV3(db, fts5);
  }

  // Always ensure FTS tables exist and are populated (fixes migration gap)
  ensureFts(db, fts5);
}
