import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { processInbox } from './ingest/pipeline.js';
import { log, setLogLevel } from './logger.js';
import { MemoryCompressor } from './memory/compressor.js';
import { EpisodicMemory } from './memory/episodic.js';
import { SemanticMemory } from './memory/semantic.js';
import { resolveProjectRoot } from './project-root.js';
import { generateDecisions } from './resources/decisions.js';
import { generateProjectMap } from './resources/project-map.js';
import { generateRecent } from './resources/recent.js';
import { initStorage } from './storage/init.js';
import { handleAudit } from './tools/audit.js';
import { handleCompact } from './tools/compact.js';
import { handleConfig } from './tools/config.js';
import { ConfirmationTokenStore } from './tools/confirmation-token.js';
import { handleDoctor } from './tools/doctor.js';
import { handleExplore } from './tools/explore.js';
import { handleForget } from './tools/forget.js';
import { handlePurge } from './tools/purge.js';
import { handleRemember } from './tools/remember.js';
import { handleScan } from './tools/scan.js';
import { handleSearch } from './tools/search.js';
import { handleStatus } from './tools/status.js';
import { handleTimeline } from './tools/timeline.js';
import type { DatabaseAdapter, IngestMetrics, LocusConfig, ProjectRootMethod } from './types.js';
import { LOCUS_DEFAULTS } from './types.js';
import { projectHash } from './utils.js';

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

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function createServer(options?: CreateServerOptions): Promise<ServerContext> {
  const cwd = options?.cwd ?? process.cwd();

  // 1. Resolve project root
  const { root, method } = resolveProjectRoot(cwd);
  const projectName = basename(root);

  // 2. Compute DB path (skip hash when caller supplies explicit path)
  const dbPath =
    options?.dbPath ??
    join(homedir(), '.claude', 'memory', `locus-${projectHash(root)}`, 'locus.db');
  const logPath = join(homedir(), '.claude', 'memory', 'locus.log');

  // 3. Initialise storage
  const { db, backend, fts5 } = await initStorage(dbPath);

  // 3b. Compute inbox directory (sibling to DB file)
  const inboxDir = join(dirname(dbPath), 'inbox');

  // 4. Config (defaults + env overrides)
  const config: LocusConfig = { ...LOCUS_DEFAULTS };
  const envCapture = process.env.LOCUS_CAPTURE_LEVEL;
  if (envCapture === 'metadata' || envCapture === 'redacted' || envCapture === 'full') {
    config.captureLevel = envCapture;
  }

  // 5. Memory layers
  const semantic = new SemanticMemory(db, fts5);
  const episodic = new EpisodicMemory(db);
  // MemoryCompressor is used internally (not exposed via ServerContext)
  const _compressor = new MemoryCompressor(config);
  void _compressor;

  // 6. Confirmation token stores (separate prefix per operation)
  const purgeTokenStore = new ConfirmationTokenStore('purge');
  const forgetTokenStore = new ConfirmationTokenStore('forget');

  // 7. Log startup info
  const fileCountRow = db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM files');
  const fileCount = fileCountRow?.cnt ?? 0;
  log('info', `Locus started: backend=${backend} fts5=${fts5} db=${dbPath} files=${fileCount}`);
  if (config.captureLevel !== 'metadata') {
    log(
      'info',
      `WARNING: captureLevel is '${config.captureLevel}' (not 'metadata') — content may be stored`,
    );
  }

  // 8. Process inbox at startup (all events, no batch limit)
  let _lastIngestMetrics: IngestMetrics | null = null;
  let lastIngestTime = 0;
  const INGEST_DEBOUNCE_MS = 30_000;

  try {
    const startupMetrics = processInbox(inboxDir, db, {
      batchLimit: 0,
      captureLevel: config.captureLevel,
      fts5Available: fts5,
    });
    _lastIngestMetrics = startupMetrics;
    lastIngestTime = Date.now();
    if (startupMetrics.processed > 0) {
      log(
        'info',
        `Inbox startup: processed=${startupMetrics.processed} errors=${startupMetrics.errors}`,
      );
    }
  } catch (err: unknown) {
    log('error', `Inbox startup error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 9. MCP server
  const server = new McpServer({ name: 'locus', version: '0.2.0' });

  // ─── Resources ───────────────────────────────────────────────────────────────

  server.resource('project-map', 'memory://project-map', async () => ({
    contents: [
      {
        uri: 'memory://project-map',
        mimeType: 'text/plain',
        text: generateProjectMap(db, projectName),
      },
    ],
  }));

  server.resource('decisions', 'memory://decisions', async () => ({
    contents: [
      {
        uri: 'memory://decisions',
        mimeType: 'text/plain',
        text: generateDecisions(db),
      },
    ],
  }));

  server.resource('recent', 'memory://recent', async () => ({
    contents: [
      {
        uri: 'memory://recent',
        mimeType: 'text/plain',
        text: generateRecent(db, config.captureLevel),
      },
    ],
  }));

  // ─── Tools ───────────────────────────────────────────────────────────────────

  // 1. memory_explore
  server.tool('memory_explore', { path: z.string() }, async ({ path }) => ({
    content: [{ type: 'text' as const, text: handleExplore(path, { db }) }],
  }));

  // 2. memory_search (with pre-search inbox processing)
  server.tool(
    'memory_search',
    {
      query: z.string(),
      timeRange: z
        .object({
          from: z.number().optional(),
          to: z.number().optional(),
          relative: z.enum(['today', 'yesterday', 'this_week', 'last_7d', 'last_30d']).optional(),
        })
        .optional()
        .describe('Filter by time range (absolute or relative)'),
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
    },
    async ({ query, timeRange, filePath, kind, source, limit, offset }) => {
      // Process inbox before search (debounced, max 50 events)
      if (Date.now() - lastIngestTime > INGEST_DEBOUNCE_MS) {
        try {
          const metrics = processInbox(inboxDir, db, {
            batchLimit: 50,
            captureLevel: config.captureLevel,
            fts5Available: fts5,
          });
          _lastIngestMetrics = metrics;
          lastIngestTime = Date.now();
        } catch {
          // Pre-search ingest failure should not block the search
        }
      }

      const results = handleSearch(
        query,
        { db, semantic, fts5 },
        {
          timeRange,
          filePath,
          kind,
          source,
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

  // 3. memory_remember
  server.tool(
    'memory_remember',
    { text: z.string(), tags: z.array(z.string()).optional() },
    async ({ text, tags }) => {
      const entry = handleRemember(text, tags ?? [], { semantic });
      return {
        content: [{ type: 'text' as const, text: `Remembered (id=${entry.id}): ${entry.content}` }],
      };
    },
  );

  // 4. memory_forget
  server.tool(
    'memory_forget',
    { query: z.string(), confirmToken: z.string().optional() },
    async ({ query, confirmToken }) => {
      const result = handleForget(query, { semantic, tokenStore: forgetTokenStore }, confirmToken);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  // 5. memory_scan
  server.tool('memory_scan', {}, async () => {
    const result = await handleScan({ projectPath: root, db, config });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.stats) }] };
  });

  // 6. memory_status
  server.tool('memory_status', {}, async () => {
    const status = handleStatus({
      projectPath: cwd,
      projectRoot: root,
      projectRootMethod: method,
      dbPath,
      db,
      config,
      backend,
      fts5,
      inboxDir,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(status) }] };
  });

  // 7. memory_doctor
  server.tool('memory_doctor', {}, async () => {
    const report = handleDoctor({
      nodeVersion: process.version,
      backend,
      fts5,
      dbPath,
      projectRoot: root,
      projectRootMethod: method,
      captureLevel: config.captureLevel,
      logPath,
      db,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  });

  // 8. memory_audit
  server.tool('memory_audit', {}, async () => {
    const report = handleAudit({
      db,
      projectPath: cwd,
      dbPath,
      logPath,
      captureLevel: config.captureLevel,
    });
    return { content: [{ type: 'text' as const, text: report }] };
  });

  // 9. memory_purge
  server.tool('memory_purge', { confirmToken: z.string().optional() }, async ({ confirmToken }) => {
    const result = handlePurge(
      { db, dbPath, projectPath: cwd, tokenStore: purgeTokenStore, inboxDir },
      confirmToken,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  });

  // 10. memory_config
  server.tool('memory_config', {}, async () => {
    const result = handleConfig(config, process.env, fts5);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  // 11. memory_compact
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
      const result = handleCompact(db, params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // 12. memory_timeline
  server.tool(
    'memory_timeline',
    {
      timeRange: z
        .object({
          from: z.number().optional(),
          to: z.number().optional(),
          relative: z.enum(['today', 'yesterday', 'this_week', 'last_7d', 'last_30d']).optional(),
        })
        .optional()
        .describe('Filter by time range (absolute or relative)'),
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
    },
    async ({ timeRange, kind, filePath, summary, limit, offset }) => {
      const entries = handleTimeline({ db }, { timeRange, kind, filePath, summary, limit, offset });
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries) }] };
    },
  );

  return {
    server,
    db,
    config,
    backend,
    fts5,
    projectRoot: root,
    projectRootMethod: method,
    inboxDir,
    semantic,
    episodic,
    cleanup: () => db.close(),
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

main().catch((error: unknown) => {
  log('error', `Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
