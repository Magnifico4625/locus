import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { log, setLogLevel } from './logger.js';
import { handleAudit } from './tools/audit.js';
import { handleDoctor } from './tools/doctor.js';
import { handleExplore } from './tools/explore.js';
import { handleForget } from './tools/forget.js';
import { handlePurge } from './tools/purge.js';
import { handleRemember } from './tools/remember.js';
import { handleScan } from './tools/scan.js';
import { handleSearch } from './tools/search.js';
import { handleStatus } from './tools/status.js';

// TODO(Task 30): Replace these stubs with real runtime context
// These exist only to make typecheck pass before server wiring.
void handleExplore;
void handleSearch;
void handleRemember;
void handleForget;
void handleScan;
void handleStatus;
void handleDoctor;
void handleAudit;
void handlePurge;

const logLevel = (process.env.LOCUS_LOG as 'error' | 'info' | 'debug') ?? 'error';
setLogLevel(logLevel);

const server = new McpServer({
  name: 'locus',
  version: '0.1.0',
});

// ─── Resources (auto-attached, compact) ───

server.resource('project-map', 'memory://project-map', async () => ({
  contents: [
    { uri: 'memory://project-map', mimeType: 'text/plain', text: 'Project map not yet wired.' },
  ],
}));

server.resource('decisions', 'memory://decisions', async () => ({
  contents: [
    { uri: 'memory://decisions', mimeType: 'text/plain', text: 'Decisions not yet wired.' },
  ],
}));

server.resource('recent', 'memory://recent', async () => ({
  contents: [{ uri: 'memory://recent', mimeType: 'text/plain', text: 'Recent not yet wired.' }],
}));

// ─── Tools (stubs — will be wired in Task 30) ───

server.tool('memory_explore', { path: z.string() }, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_search', { query: z.string() }, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool(
  'memory_remember',
  { text: z.string(), tags: z.array(z.string()).optional() },
  async () => ({
    content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
  }),
);

server.tool('memory_forget', { query: z.string() }, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_scan', {}, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_status', {}, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_doctor', {}, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_audit', {}, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

server.tool('memory_purge', { confirmToken: z.string().optional() }, async () => ({
  content: [{ type: 'text' as const, text: 'Not yet wired to runtime context.' }],
}));

// ─── Start ───

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', `Locus MCP server started (log level: ${logLevel})`);
}

main().catch((error: unknown) => {
  log('error', `Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
