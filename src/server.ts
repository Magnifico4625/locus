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

const logLevel = (process.env.LOCUS_LOG as 'error' | 'info' | 'debug') ?? 'error';
setLogLevel(logLevel);

const server = new McpServer({
  name: 'locus',
  version: '0.1.0',
});

// ─── Resources (auto-attached, compact) ───

server.resource('project-map', 'memory://project-map', async () => ({
  // TODO(Task 21 wiring): pass real db + projectName once context is available
  contents: [
    { uri: 'memory://project-map', mimeType: 'text/plain', text: 'Project map not yet wired.' },
  ],
}));

server.resource('decisions', 'memory://decisions', async () => ({
  // TODO(Task 22 wiring): pass real db once context is available
  contents: [
    { uri: 'memory://decisions', mimeType: 'text/plain', text: 'Decisions not yet wired.' },
  ],
}));

server.resource('recent', 'memory://recent', async () => ({
  // TODO(Task 23 wiring): pass real db once context is available
  contents: [{ uri: 'memory://recent', mimeType: 'text/plain', text: 'Recent not yet wired.' }],
}));

// ─── Tools (on-demand) ───

server.tool('memory_explore', { path: z.string() }, async ({ path }) => ({
  content: [{ type: 'text' as const, text: await handleExplore(path) }],
}));

server.tool('memory_search', { query: z.string() }, async ({ query }) => {
  const results = await handleSearch(query);
  return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
});

server.tool(
  'memory_remember',
  { text: z.string(), tags: z.array(z.string()).optional() },
  async ({ text, tags }) => {
    await handleRemember(text, tags);
    return { content: [{ type: 'text' as const, text: 'Remembered.' }] };
  },
);

server.tool('memory_forget', { query: z.string() }, async ({ query }) => {
  const count = await handleForget(query);
  return { content: [{ type: 'text' as const, text: `Deleted ${count} entries.` }] };
});

server.tool('memory_scan', {}, async () => {
  const result = await handleScan();
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.stats, null, 2) }] };
});

server.tool('memory_status', {}, async () => {
  const status = await handleStatus();
  return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
});

server.tool('memory_doctor', {}, async () => {
  const report = await handleDoctor();
  return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
});

server.tool('memory_audit', {}, async () => {
  const audit = await handleAudit();
  return { content: [{ type: 'text' as const, text: audit }] };
});

server.tool('memory_purge', { confirmToken: z.string().optional() }, async ({ confirmToken }) => {
  const response = await handlePurge(confirmToken);
  return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
});

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
