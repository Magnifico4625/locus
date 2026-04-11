// ─── Storage Layer ───

export interface DatabaseAdapter {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): RunResult;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  close(): void;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// ─── Confidence ───

export type ConfidenceLevel = 'high' | 'medium';

export type ConfidenceReason =
  | 'barrel'
  | 'dynamic-import'
  | 'alias-unresolved'
  | 'multiline-export'
  | 'generated'
  | 'large-file';

export interface Confidence {
  level: ConfidenceLevel;
  reason?: ConfidenceReason;
}

// ─── Structural Map ───

export interface FileEntry {
  relativePath: string;
  exports: ExportEntry[];
  imports: ImportEntry[];
  reExports: ReExportEntry[];
  fileType: 'module' | 'barrel' | 'config' | 'script' | 'test';
  language: 'typescript' | 'javascript' | 'python';
  lines: number;
  confidence: Confidence;
  lastScanned: number;
  skippedReason?: string;
}

export interface ExportEntry {
  name: string;
  kind: 'function' | 'class' | 'const' | 'let' | 'var' | 'type' | 'interface' | 'enum' | 'unknown';
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface ImportEntry {
  source: string;
  resolvedPath?: string;
  isTypeOnly: boolean;
  isDynamic: boolean;
}

export interface ReExportEntry {
  source: string;
  names: string[] | '*';
}

// ─── Semantic Memory ───

export interface MemoryEntry {
  id: number;
  layer: 'semantic' | 'episodic';
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
}

// ─── Search ───

export interface SearchResult {
  layer: 'structural' | 'semantic' | 'episodic' | 'conversation';
  content: string;
  relevance: number;
  source: string;
}

// ─── Scanner ───

export interface ScanResult {
  files: FileEntry[];
  stats: ScanStats;
  strategy: ScanStrategy;
}

export interface ScanStats {
  totalFiles: number;
  scannedFiles: number;
  skippedFiles: number;
  highConfidence: number;
  mediumConfidence: number;
  durationMs: number;
}

export interface ScanStrategy {
  type: 'git-diff' | 'mtime' | 'full' | 'skip';
  filesToScan: string[];
  reason: string;
}

// ─── Error Classification ───

export type ErrorKind =
  | 'file_not_found'
  | 'permission_denied'
  | 'timeout'
  | 'syntax_error'
  | 'network_error'
  | 'exit_nonzero'
  | 'unknown';

// ─── Hook Capture ───

export interface HookCaptureMetadata {
  toolName: string;
  filePaths: string[];
  status: 'success' | 'error';
  exitCode?: number;
  timestamp: number;
  durationMs: number;
  diffStats?: { added: number; removed: number };
}

export interface HookCaptureRedacted extends HookCaptureMetadata {
  errorKind?: ErrorKind;
  bashCommand?: string;
}

export interface HookCaptureFull extends HookCaptureRedacted {
  bashFullCommand?: string;
  toolInput?: unknown;
  toolOutput?: string;
  fileContent?: string;
}

export type HookCapture = HookCaptureMetadata | HookCaptureRedacted | HookCaptureFull;

// ─── Conversation Events (v3 Carbon Copy) ───

export type EventKind =
  | 'user_prompt'
  | 'ai_response'
  | 'tool_use'
  | 'file_diff'
  | 'session_start'
  | 'session_end';

export type EventSignificance = 'high' | 'medium' | 'low';

// ─── Event Payloads ───

export interface UserPromptPayload {
  prompt: string;
}

export interface AiResponsePayload {
  response: string;
  model?: string;
}

export interface ToolUsePayload {
  tool: string;
  files: string[];
  status: string;
  exitCode?: number;
  diffStats?: { added: number; removed: number };
}

export interface FileDiffPayload {
  path: string;
  added: number;
  removed: number;
  diff?: string;
}

export interface SessionStartPayload {
  tool: string;
  model?: string;
}

export interface SessionEndPayload {
  summary?: string;
}

// ─── Inbox Event (JSON file protocol) ───

export interface InboxEvent {
  version: number;
  event_id: string;
  source: string;
  source_event_id?: string;
  project_root: string;
  session_id?: string;
  timestamp: number;
  kind: EventKind;
  payload: Record<string, unknown>;
}

// ─── Conversation Event DB Rows ───

export interface ConversationEventRow {
  id: number;
  event_id: string;
  source: string;
  source_event_id: string | null;
  project_root: string;
  session_id: string | null;
  timestamp: number;
  kind: string;
  payload_json: string | null;
  significance: string | null;
  tags_json: string | null;
  created_at: number;
}

export interface EventFileRow {
  id: number;
  event_id: string;
  file_path: string;
}

export interface IngestLogRow {
  id: number;
  event_id: string;
  source: string;
  source_event_id: string | null;
  processed_at: number;
}

// ─── Ingest Pipeline ───

export interface IngestMetrics {
  processed: number;
  skipped: number;
  duplicates: number;
  filtered: number;
  errors: number;
  durationMs: number;
  remaining: number;
}

// ─── Time Range (extended search) ───

export type TimeRangeRelative = 'today' | 'yesterday' | 'this_week' | 'last_7d' | 'last_30d';

export interface TimeRange {
  from?: number;
  to?: number;
  relative?: TimeRangeRelative;
}

// ─── Configuration ───

export type CaptureLevel = 'metadata' | 'redacted' | 'full';

export interface LocusConfig {
  captureLevel: CaptureLevel;
  logLevel: 'error' | 'info' | 'debug';
  maskPaths: boolean;
  compressionMode: 'manual' | 'threshold' | 'aggressive';
  compressionThreshold: number;
  maxScanFiles: number;
  maxFileSize: number;
  rescanThreshold: number;
  rescanAbsoluteMax: number;
  fullRescanCooldown: number;
  minScanInterval: number;
}

export const LOCUS_DEFAULTS: LocusConfig = {
  captureLevel: 'metadata',
  logLevel: 'error',
  maskPaths: false,
  compressionMode: 'threshold',
  compressionThreshold: 10000,
  maxScanFiles: 10000,
  maxFileSize: 1048576,
  rescanThreshold: 0.3,
  rescanAbsoluteMax: 200,
  fullRescanCooldown: 300,
  minScanInterval: 10,
};

// ─── Project Identity ───

export type ProjectRootMethod = 'git-root' | 'project-marker' | 'cwd-fallback';

export interface ProjectIdentity {
  root: string;
  method: ProjectRootMethod;
  hash: string;
}

// ─── Status ───

export interface MemoryStatus {
  projectPath: string;
  projectRoot: string;
  projectRootMethod: ProjectRootMethod;
  dbPath: string;
  dbSizeBytes: number;
  captureLevel: CaptureLevel;
  totalFiles: number;
  skippedFiles: number;
  totalMemories: number;
  totalEpisodes: number;
  totalConversationEvents: number;
  inboxPending: number;
  lastScan: number;
  scanStrategy: string;
  nodeVersion: string;
  storageBackend: 'node:sqlite' | 'sql.js';
  fts5Available: boolean;
  searchEngine: 'FTS5' | 'LIKE fallback';
}

// ─── Doctor ───

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failures: number;
}

// ─── Purge ───

export interface PurgeResponsePending {
  status: 'pending_confirmation';
  confirmToken: string;
  message: string;
  stats: {
    files: number;
    memories: number;
    episodes: number;
    conversationEvents: number;
    dbSizeBytes: number;
  };
}

export interface PurgeResponseDone {
  status: 'purged';
  message: string;
  clearedDbPath: string;
}

export interface PurgeResponseError {
  status: 'error';
  message: string;
}

export type PurgeResponse = PurgeResponsePending | PurgeResponseDone | PurgeResponseError;

// ─── Forget ───

export interface ForgetResponseDeleted {
  status: 'deleted';
  deleted: number;
  message: string;
}

export interface ForgetResponsePending {
  status: 'pending_confirmation';
  confirmToken: string;
  matches: number;
  message: string;
}

export interface ForgetResponseError {
  status: 'error';
  message: string;
}

export type ForgetResponse = ForgetResponseDeleted | ForgetResponsePending | ForgetResponseError;

// ─── Codex Import ───

export type CodexImportCaptureMode = 'off' | CaptureLevel;

export interface MemoryImportCodexResponseOk {
  status: 'ok';
  captureMode: Exclude<CodexImportCaptureMode, 'off'>;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  filesScanned: number;
  latestSession?: string;
  processed: number;
  remaining: number;
  message: string;
}

export interface MemoryImportCodexResponseDisabled {
  status: 'disabled';
  captureMode: 'off';
  imported: 0;
  skipped: 0;
  duplicates: 0;
  errors: 0;
  filesScanned: 0;
  message: string;
}

export interface MemoryImportCodexResponseError {
  status: 'error';
  captureMode: CodexImportCaptureMode;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  filesScanned: number;
  latestSession?: string;
  processed?: number;
  remaining?: number;
  message: string;
}

export type MemoryImportCodexResponse =
  | MemoryImportCodexResponseOk
  | MemoryImportCodexResponseDisabled
  | MemoryImportCodexResponseError;
