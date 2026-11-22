import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCodexSessionsToInbox } from '@locus/codex';
import { resolveLogPath } from '@locus/shared-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { processInbox } from './ingest/pipeline.js';
import { log, setLogLevel } from './logger.js';
import { runDurableExtraction } from './memory/durable-runner.js';
import type { EpisodicMemory } from './memory/episodic.js';
import type { SemanticMemory } from './memory/semantic.js';
import { generateDecisions } from './resources/decisions.js';
import { generateProjectMap } from './resources/project-map.js';
import { generateRecent } from './resources/recent.js';
import { handleAudit } from './tools/audit.js';
import { coordinateCodexAutoImport } from './tools/auto-import-codex.js';
import { handleCalendar } from './tools/calendar.js';
import { collectCodexDiagnostics } from './tools/codex-diagnostics.js';
import { handleCompact } from './tools/compact.js';
import { handleConfig } from './tools/config.js';
import { ConfirmationTokenStore } from './tools/confirmation-token.js';
import { handleDoctor } from './tools/doctor.js';
import { handleExplore } from './tools/explore.js';
import { handleForget } from './tools/forget.js';
import { handleImportCodex } from './tools/import-codex.js';
import { handleProjectState } from './tools/project-state.js';
import { handlePurge } from './tools/purge.js';
import { handleRecall } from './tools/recall.js';
import { handleRemember } from './tools/remember.js';
import { handleReview } from './tools/review.js';
import { handleScan } from './tools/scan.js';
import { handleSearch } from './tools/search.js';
import { handleStatus } from './tools/status.js';
import { handleTimeline } from './tools/timeline.js';
import type { DatabaseAdapter, LocusConfig, ProjectRootMethod } from './types.js';
import { DURABLE_MEMORY_TYPES, LOCUS_DEFAULTS } from './types.js';
import { type WorkspaceEntry, WorkspacePool } from './workspace-pool.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface CreateServerOptions {
  cwd?: string;
  dbPath?: string;
}

export interface ServerContext {
  server: McpServer;
  db: DatabaseAdapter;
  config: LocusConfig;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
  projectRoot: string;
  projectRootMethod: ProjectRootMethod;
  inboxDir: string;
  semantic: SemanticMemory;
  episodic: EpisodicMemory;
  cleanup: () => void;
}

const INGEST_DEBOUNCE_MS = 30_000;

function resolveServerVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const runtimeJson = join(dir, 'runtime.json');
      if (existsSync(runtimeJson)) {
        const parsed = JSON.parse(readFileSync(runtimeJson, 'utf8')) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          return parsed.version;
        }
      }

      const pkgJson = join(dir, 'package.json');
      if (existsSync(pkgJson)) {
        const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (
          (parsed.name === 'locus-memory' || parsed.name === '@locus/core') &&
          typeof parsed.version === 'string' &&
          parsed.version.length > 0
        ) {
          return parsed.version;
        }
      }

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Fall through to default version
  }
  return '3.7.0';
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function createServer(options?: CreateServerOptions): Promise<ServerContext> {
  const cwd = options?.cwd ?? process.cwd();
  const logPath = resolveLogPath();

  // 1. Config (defaults + env overrides)
  const config: LocusConfig = { ...LOCUS_DEFAULTS };
  const envCapture = process.env.LOCUS_CAPTURE_LEVEL;
  if (envCapture === 'metadata' || envCapture === 'redacted' || envCapture === 'full') {
    config.captureLevel = envCapture;
  }

  if (config.captureLevel !== 'metadata') {
    log(
      'info',
      `WARNING: captureLevel is '${config.captureLevel}' (not 'metadata') — content may be stored`,
    );
  }

  // 2. Workspace pool + initial storage
  const pool = new WorkspacePool({
    initialCwd: cwd,
    fixedDbPath: options?.dbPath,
    config,
  });
  const initialWorkspace = await pool.getOrOpenInitial();

  // 3. Confirmation token stores (separate prefix per operation)
  const purgeTokenStore = new ConfirmationTokenStore('purge');
  const forgetTokenStore = new ConfirmationTokenStore('forget');

  // 4. MCP server
  const server = new McpServer({ name: 'locus', version: resolveServerVersion() });

  if (!options?.dbPath) {
    const refreshActiveWorkspaceFromRoots = async (): Promise<void> => {
      try {
        const capabilities = server.server.getClientCapabilities();
        if (!capabilities?.roots) {
          return;
        }

        const response = await server.server.listRoots();
        await pool.setActiveFromRootUris(response.roots.map((rootItem) => rootItem.uri));
      } catch (err: unknown) {
        log(
          'error',
          `MCP roots refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    server.server.oninitialized = () => {
      void refreshActiveWorkspaceFromRoots();
    };

    server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await refreshActiveWorkspaceFromRoots();
    });
  }

  // ─── Resources ───────────────────────────────────────────────────────────────

  server.resource('project-map', 'memory://project-map', async () => {
    const active = pool.getActive();
    return {
      contents: [
        {
          uri: 'memory://project-map',
          mimeType: 'text/plain',
          text: generateProjectMap(active.db, active.projectName),
        },
      ],
    };
  });

  server.resource('decisions', 'memory://decisions', async () => {
    const active = pool.getActive();
    return {
      contents: [
        {
          uri: 'memory://decisions',
          mimeType: 'text/plain',
          text: generateDecisions(active.db),
        },
      ],
    };
  });

  server.resource('recent', 'memory://recent', async () => {
    const active = pool.getActive();
    return {
      contents: [
        {
          uri: 'memory://recent',
          mimeType: 'text/plain',
          text: generateRecent(active.db, config.captureLevel),
        },
      ],
    };
  });

  // ─── Pre-query sync helper ──────────────────────────────────────────────────

  function runPreQuerySyncFlow(workspace: WorkspaceEntry, now: number): void {
    const autoImport = coordinateCodexAutoImport({
      now,
      snapshot: workspace.codexAutoImportSnapshot,
      runImport: () =>
        handleImportCodex(
          { latestOnly: true },
          {
            db: workspace.db,
            inboxDir: workspace.inboxDir,
            captureLevel: config.captureLevel,
            fts5Available: workspace.fts5,
            projectRoot: workspace.projectRoot,
            env: process.env,
            processInbox,
            runDurableExtraction,
            importCodexSessionsToInbox,
          },
        ),
    });
    workspace.codexAutoImportSnapshot = autoImport.snapshot;

    if (!autoImport.processedInbox && now - workspace.lastIngestTime > INGEST_DEBOUNCE_MS) {
      try {
        const metrics = processInbox(workspace.inboxDir, workspace.db, {
          batchLimit: 50,
          captureLevel: config.captureLevel,
          fts5Available: workspace.fts5,
          projectRoot: workspace.projectRoot,
        });
        runDurableExtraction(workspace.db);
        workspace.lastIngestMetrics = metrics;
        workspace.lastIngestTime = now;
      } catch {
        // Pre-query ingest failure should not block search or recall
      }
    }
  }

  const timeRangeSchema = z
    .object({
      from: z.number().optional(),
      to: z.number().optional(),
      relative: z
        .enum([
          'today',
          'yesterday',
          'this_week',
          'last_7d',
          'last_30d',
          'this_month',
          'last_month',
        ])
        .optional(),
    })
    .optional();

  const optionalProjectRootSchema = z
    .string()
    .optional()
    .describe('Optional project root path to target a specific workspace');

  // ─── Tools ───────────────────────────────────────────────────────────────────

  // 1. memory_explore
  server.tool('memory_explore', { path: z.string() }, async ({ path }) => {
    const active = pool.getActive();
    return {
      content: [{ type: 'text' as const, text: handleExplore(path, { db: active.db }) }],
    };
  });

  // 2. memory_search (with Codex auto-import + pre-search inbox processing)
  server.tool(
    'memory_search',
    {
      query: z.string(),
      timeRange: timeRangeSchema.describe('Filter by time range (absolute or relative)'),
      filePath: z.string().optional().describe('Filter by file path (exact match in event_files)'),
      kind: z
        .enum([
          'user_prompt',
          'ai_response',
          'tool_use',
          'file_diff',
          'session_start',
          'session_end',
        ])
        .optional()
        .describe('Filter by event kind'),
      source: z.string().optional().describe('Filter by event source'),
      limit: z.number().optional().describe('Max conversation results (default 20)'),
      offset: z.number().optional().describe('Skip N conversation results'),
      projectRoot: optionalProjectRootSchema,
    },
    async ({ query, timeRange, filePath, kind, source, limit, offset, projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      runPreQuerySyncFlow(workspace, Date.now());

      const results = handleSearch(
        query,
        { db: workspace.db, semantic: workspace.semantic, fts5: workspace.fts5 },
        {
          timeRange,
          filePath,
          kind,
          source,
          projectRoot: workspace.projectRoot,
          limit,
          offset,
        },
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results),
          },
        ],
      };
    },
  );

  // 2b. memory_recall (with the same Codex auto-import + pre-query inbox processing)
  server.tool(
    'memory_recall',
    {
      question: z.string(),
      timeRange: timeRangeSchema.describe(
        'Filter recall candidates by time range (absolute or relative)',
      ),
      limit: z
        .number()
        .optional()
        .describe('Max recall candidates to inspect per source (default 10)'),
      projectRoot: optionalProjectRootSchema,
    },
    async ({ question, timeRange, limit, projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      const now = Date.now();
      runPreQuerySyncFlow(workspace, now);

      const result = handleRecall(
        question,
        { db: workspace.db, now, projectRoot: workspace.projectRoot },
        {
          timeRange,
          limit,
          now,
        },
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // 2c. memory_calendar (with the same debounced pre-query flow)
  server.tool(
    'memory_calendar',
    {
      timeRange: timeRangeSchema.describe('Filter memory buckets by time range'),
      granularity: z.enum(['day', 'week', 'month']).optional(),
      limit: z.number().optional(),
      projectRoot: optionalProjectRootSchema,
    },
    async ({ timeRange, granularity, limit, projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      const now = Date.now();
      runPreQuerySyncFlow(workspace, now);

      const result = handleCalendar(
        { db: workspace.db, projectRoot: workspace.projectRoot, now },
        {
          timeRange,
          granularity,
          limit,
        },
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // 3a. memory_review
  server.tool(
    'memory_review',
    {
      state: z.enum(['active', 'stale', 'superseded', 'archivable']).optional(),
      topicKey: z.string().optional(),
      memoryType: z.enum(DURABLE_MEMORY_TYPES).optional(),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum durable evidence confidence to include (0-1)'),
      limit: z.number().optional().describe('Max review candidates to return (default 20)'),
    },
    async ({ state, topicKey, memoryType, confidence, limit }) => {
      const active = pool.getActive();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              handleReview({ db: active.db }, { state, topicKey, memoryType, confidence, limit }),
            ),
          },
        ],
      };
    },
  );

  // 3b. memory_remember
  server.tool(
    'memory_remember',
    {
      text: z.string(),
      tags: z.array(z.string()).optional(),
      projectRoot: optionalProjectRootSchema,
    },
    async ({ text, tags, projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      const entry = handleRemember(text, tags ?? [], {
        semantic: workspace.semantic,
        projectRoot: workspace.projectRoot,
      });
      return {
        content: [{ type: 'text' as const, text: `Remembered (id=${entry.id}): ${entry.content}` }],
      };
    },
  );

  // 4. memory_import_codex
  server.tool(
    'memory_import_codex',
    {
      latestOnly: z.boolean().optional().describe('Import only the newest rollout file'),
      projectRoot: z.string().optional().describe('Filter Codex events by project root'),
      sessionId: z.string().optional().describe('Filter Codex events by session id'),
      since: z
        .number()
        .optional()
        .describe('Import only events at or after this Unix timestamp in milliseconds'),
    },
    async ({ latestOnly, projectRoot, sessionId, since }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      const result = handleImportCodex(
        { latestOnly, projectRoot, sessionId, since },
        {
          db: workspace.db,
          inboxDir: workspace.inboxDir,
          captureLevel: config.captureLevel,
          fts5Available: workspace.fts5,
          projectRoot: workspace.projectRoot,
          env: process.env,
          processInbox,
          runDurableExtraction,
          importCodexSessionsToInbox,
        },
      );

      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  // 5. memory_forget
  server.tool(
    'memory_forget',
    { query: z.string(), confirmToken: z.string().optional() },
    async ({ query, confirmToken }) => {
      const active = pool.getActive();
      const result = handleForget(
        query,
        { semantic: active.semantic, tokenStore: forgetTokenStore },
        confirmToken,
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  // 6. memory_scan
  server.tool('memory_scan', {}, async () => {
    const active = pool.getActive();
    const result = await handleScan({ projectPath: active.projectRoot, db: active.db, config });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.stats) }] };
  });

  // 6b. memory_project_state (runs pre-query sync/ingest first)
  server.tool(
    'memory_project_state',
    {
      projectRoot: optionalProjectRootSchema,
    },
    async ({ projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      runPreQuerySyncFlow(workspace, Date.now());
      const result = handleProjectState({ db: workspace.db, projectRoot: workspace.projectRoot });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  // 7. memory_status
  server.tool(
    'memory_status',
    {
      projectRoot: optionalProjectRootSchema,
    },
    async ({ projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      const status = handleStatus({
        projectPath: workspace.cwd,
        projectRoot: workspace.projectRoot,
        projectRootMethod: workspace.projectRootMethod,
        dbPath: workspace.dbPath,
        db: workspace.db,
        config,
        backend: workspace.backend,
        fts5: workspace.fts5,
        inboxDir: workspace.inboxDir,
        codexAutoImportSnapshot: workspace.codexAutoImportSnapshot,
        codexDiagnostics: collectCodexDiagnostics({ db: workspace.db, env: process.env }),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(status) }] };
    },
  );

  // 8. memory_doctor
  server.tool('memory_doctor', {}, async () => {
    const active = pool.getActive();
    const report = handleDoctor({
      nodeVersion: process.version,
      backend: active.backend,
      fts5: active.fts5,
      dbPath: active.dbPath,
      projectRoot: active.projectRoot,
      projectRootMethod: active.projectRootMethod,
      captureLevel: config.captureLevel,
      logPath,
      db: active.db,
      codexDiagnostics: collectCodexDiagnostics({ db: active.db, env: process.env }),
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  });

  // 9. memory_audit
  server.tool('memory_audit', {}, async () => {
    const active = pool.getActive();
    const report = handleAudit({
      db: active.db,
      projectPath: active.cwd,
      dbPath: active.dbPath,
      logPath,
      captureLevel: config.captureLevel,
      fts5: active.fts5,
    });
    return { content: [{ type: 'text' as const, text: report }] };
  });

  // 10. memory_purge
  server.tool('memory_purge', { confirmToken: z.string().optional() }, async ({ confirmToken }) => {
    const active = pool.getActive();
    const result = handlePurge(
      {
        db: active.db,
        dbPath: active.dbPath,
        projectPath: active.cwd,
        tokenStore: purgeTokenStore,
        inboxDir: active.inboxDir,
      },
      confirmToken,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  });

  // 11. memory_config
  server.tool('memory_config', {}, async () => {
    const result = handleConfig(config, process.env, initialWorkspace.fts5);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  // 12. memory_compact
  server.tool(
    'memory_compact',
    {
      maxAgeDays: z.number().optional().describe('Delete entries older than this (default: 30)'),
      keepSessions: z
        .number()
        .optional()
        .describe('Always keep this many recent sessions (default: 5)'),
    },
    async (params) => {
      const active = pool.getActive();
      const result = handleCompact(active.db, params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 13. memory_timeline (runs pre-query sync/ingest first)
  server.tool(
    'memory_timeline',
    {
      timeRange: timeRangeSchema.describe('Filter by time range (absolute or relative)'),
      kind: z
        .enum([
          'user_prompt',
          'ai_response',
          'tool_use',
          'file_diff',
          'session_start',
          'session_end',
        ])
        .optional()
        .describe('Filter by event kind'),
      filePath: z.string().optional().describe('Filter by file path (exact match in event_files)'),
      summary: z
        .boolean()
        .optional()
        .describe('When true, returns headers only (kind + timestamp, no payload)'),
      limit: z.number().optional().describe('Max entries (default 20)'),
      offset: z.number().optional().describe('Skip N entries for pagination'),
      projectRoot: optionalProjectRootSchema,
    },
    async ({ timeRange, kind, filePath, summary, limit, offset, projectRoot }) => {
      const workspace = await pool.resolveForPath(projectRoot);
      runPreQuerySyncFlow(workspace, Date.now());
      const entries = handleTimeline(
        { db: workspace.db, projectRoot: workspace.projectRoot },
        { timeRange, kind, filePath, summary, limit, offset },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries) }] };
    },
  );

  return {
    server,
    db: initialWorkspace.db,
    config,
    backend: initialWorkspace.backend,
    fts5: initialWorkspace.fts5,
    projectRoot: initialWorkspace.projectRoot,
    projectRootMethod: initialWorkspace.projectRootMethod,
    inboxDir: initialWorkspace.inboxDir,
    semantic: initialWorkspace.semantic,
    episodic: initialWorkspace.episodic,
    cleanup: () => pool.cleanupAll(),
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const logLevel = (process.env.LOCUS_LOG as 'error' | 'info' | 'debug') ?? 'error';
setLogLevel(logLevel);

async function main(): Promise<void> {
  const ctx = await createServer();
  const transport = new StdioServerTransport();
  await ctx.server.connect(transport);
  log('info', `Locus MCP server started (log level: ${logLevel})`);
}

if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    log('error', `Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
