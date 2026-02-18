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
  layer: 'structural' | 'semantic' | 'episodic';
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
  lastScan: number;
  scanStrategy: string;
  nodeVersion: string;
  storageBackend: 'node:sqlite' | 'sql.js';
  fts5Available: boolean;
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
  stats: { files: number; memories: number; episodes: number; dbSizeBytes: number };
}

export interface PurgeResponseDone {
  status: 'purged';
  message: string;
  deletedDbPath: string;
}

export interface PurgeResponseError {
  status: 'error';
  message: string;
}

export type PurgeResponse = PurgeResponsePending | PurgeResponseDone | PurgeResponseError;
