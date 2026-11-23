import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDbPath } from '@locus/shared-runtime';
import { processInbox } from './ingest/pipeline.js';
import { log } from './logger.js';
import { MemoryCompressor } from './memory/compressor.js';
import { runDurableExtraction } from './memory/durable-runner.js';
import { EpisodicMemory } from './memory/episodic.js';
import { SemanticMemory } from './memory/semantic.js';
import { resolveProjectRoot } from './project-root.js';
import { normalizeProjectRootForScope } from './recall/project-scope.js';
import { initStorage } from './storage/init.js';
import { CODEX_AUTO_IMPORT_DEBOUNCE_MS } from './tools/auto-import-codex.js';
import type {
  CodexAutoImportSnapshot,
  DatabaseAdapter,
  IngestMetrics,
  LocusConfig,
  ProjectRootMethod,
} from './types.js';

export interface WorkspaceEntry {
  cwd: string;
  projectRoot: string;
  projectRootMethod: ProjectRootMethod;
  projectName: string;
  dbPath: string;
  inboxDir: string;
  db: DatabaseAdapter;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
  semantic: SemanticMemory;
  episodic: EpisodicMemory;
  lastIngestTime: number;
  lastIngestMetrics: IngestMetrics | null;
  codexAutoImportSnapshot: CodexAutoImportSnapshot;
}

export interface WorkspacePoolOptions {
  initialCwd: string;
  fixedDbPath?: string;
  config: LocusConfig;
}

export function rootUriToLocalPath(uri: string): string | undefined {
  const trimmed = uri.trim();
  if (!/^file:\/\//i.test(trimmed)) {
    return undefined;
  }

  try {
    return fileURLToPath(trimmed);
  } catch {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost')) {
        return undefined;
      }
      const decoded = decodeURIComponent(parsed.pathname);
      if (/^\/[a-zA-Z]:[\\/]/u.test(decoded)) {
        return decoded.slice(1);
      }
      return decoded || undefined;
    } catch {
      return undefined;
    }
  }
}

export class WorkspacePool {
  private readonly initialCwd: string;
  private readonly fixedDbPath?: string;
  private readonly config: LocusConfig;
  private readonly entries = new Map<string, WorkspaceEntry>();
  private readonly pending = new Map<string, Promise<WorkspaceEntry>>();
  private activeEntry?: WorkspaceEntry;

  constructor(options: WorkspacePoolOptions) {
    this.initialCwd = options.initialCwd;
    this.fixedDbPath = options.fixedDbPath;
    this.config = options.config;
  }

  async getOrOpenInitial(): Promise<WorkspaceEntry> {
    if (this.activeEntry) {
      return this.activeEntry;
    }

    const { root, method } = resolveProjectRoot(this.initialCwd);
    const dbPath = this.fixedDbPath ?? resolveDbPath(root);
    const entry = await this.openWorkspace(this.initialCwd, root, method, dbPath);
    this.activeEntry = entry;
    return entry;
  }

  getActive(): WorkspaceEntry {
    if (!this.activeEntry) {
      throw new Error('WorkspacePool has not been initialized');
    }
    return this.activeEntry;
  }

  async getOrOpenActive(): Promise<WorkspaceEntry> {
    if (this.activeEntry) {
      return this.activeEntry;
    }
    return this.getOrOpenInitial();
  }

  async resolveForPath(targetCwd?: string): Promise<WorkspaceEntry> {
    if (this.fixedDbPath) {
      return this.getOrOpenInitial();
    }

    const trimmed = targetCwd?.trim();
    if (!trimmed) {
      return this.getOrOpenActive();
    }

    const { root, method } = resolveProjectRoot(trimmed);
    return this.openWorkspace(trimmed, root, method, resolveDbPath(root));
  }

  async setActiveFromRootUris(uris: readonly string[]): Promise<WorkspaceEntry | undefined> {
    if (this.fixedDbPath) {
      return this.getOrOpenInitial();
    }

    for (const uri of uris) {
      const localPath = rootUriToLocalPath(uri);
      if (!localPath) {
        continue;
      }

      const { root, method } = resolveProjectRoot(localPath);
      const entry = await this.openWorkspace(localPath, root, method, resolveDbPath(root));
      this.activeEntry = entry;
      return entry;
    }

    return undefined;
  }

  listEntries(): WorkspaceEntry[] {
    return [...this.entries.values()];
  }

  cleanupAll(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.db.close();
      } catch {
        // Best-effort cleanup across open workspace DBs
      }
    }
    this.entries.clear();
    this.pending.clear();
    this.activeEntry = undefined;
  }

  private async openWorkspace(
    cwd: string,
    projectRoot: string,
    projectRootMethod: ProjectRootMethod,
    dbPath: string,
  ): Promise<WorkspaceEntry> {
    const key = normalizeProjectRootForScope(projectRoot);
    const cached = this.entries.get(key);
    if (cached) {
      return cached;
    }

    const inflight = this.pending.get(key);
    if (inflight) {
      return inflight;
    }

    const opening = this.createEntry(cwd, projectRoot, projectRootMethod, dbPath).then(
      (entry) => {
        this.entries.set(key, entry);
        return entry;
      },
      (error: unknown) => {
        throw error;
      },
    );

    this.pending.set(key, opening);
    try {
      return await opening;
    } finally {
      this.pending.delete(key);
    }
  }

  private async createEntry(
    cwd: string,
    projectRoot: string,
    projectRootMethod: ProjectRootMethod,
    dbPath: string,
  ): Promise<WorkspaceEntry> {
    const { db, backend, fts5 } = await initStorage(dbPath);
    const inboxDir = join(dirname(dbPath), 'inbox');
    const semantic = new SemanticMemory(db, fts5);
    const episodic = new EpisodicMemory(db);
    const _compressor = new MemoryCompressor(this.config);
    void _compressor;

    const fileCountRow = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM files');
    const fileCount = fileCountRow?.cnt ?? 0;
    log('info', `Locus started: backend=${backend} fts5=${fts5} db=${dbPath} files=${fileCount}`);

    let lastIngestMetrics: IngestMetrics | null = null;
    let lastIngestTime = 0;

    try {
      const startupMetrics = processInbox(inboxDir, db, {
        batchLimit: 0,
        captureLevel: this.config.captureLevel,
        fts5Available: fts5,
        projectRoot,
      });
      runDurableExtraction(db);
      lastIngestMetrics = startupMetrics;
      if (startupMetrics.processed > 0) {
        lastIngestTime = Date.now();
        log(
          'info',
          `Inbox startup: processed=${startupMetrics.processed} errors=${startupMetrics.errors}`,
        );
      }
    } catch (err: unknown) {
      log('error', `Inbox startup error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      cwd,
      projectRoot,
      projectRootMethod,
      projectName: basename(projectRoot),
      dbPath,
      inboxDir,
      db,
      backend,
      fts5,
      semantic,
      episodic,
      lastIngestTime,
      lastIngestMetrics,
      codexAutoImportSnapshot: {
        clientDetected: false,
        client: 'generic',
        clientSurface: 'generic',
        detectionEvidence: [],
        debounceMs: CODEX_AUTO_IMPORT_DEBOUNCE_MS,
        lastStatus: 'idle',
        lastImported: 0,
        lastDuplicates: 0,
        lastErrors: 0,
      },
    };
  }
}
