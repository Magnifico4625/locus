import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePathForIdentity } from '@locus/shared-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createLazyServer, createServer } from '../../src/server.js';
import { LOCUS_DEFAULTS, type MemoryProjectStateResult } from '../../src/types.js';
import { rootUriToLocalPath, WorkspacePool } from '../../src/workspace-pool.js';

const tempDirs: string[] = [];
const savedEnv = { ...process.env };

function makeTempDir(prefix = 'locus-workspace-pool-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function getRegisteredTool(ctx: ServerContext, name: string) {
  const registry = (
    ctx.server as {
      _registeredTools?: Record<
        string,
        { handler: (args: unknown) => Promise<{ content: Array<{ text: string }> }> }
      >;
    }
  )._registeredTools;
  const tool = registry?.[name];
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

async function callTextTool(
  ctx: ServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = getRegisteredTool(ctx, name);
  const result = await tool.handler(args);
  return result.content[0]?.text ?? '';
}

afterEach(() => {
  process.env = { ...savedEnv };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('rootUriToLocalPath', () => {
  it('converts Windows and POSIX file:// URIs and rejects non-file URIs', () => {
    const winPath = rootUriToLocalPath('file:///C:/Users/Admin/repo');
    expect(winPath ? normalizePathForIdentity(winPath) : undefined).toBe('c:/users/admin/repo');

    const posixPath = rootUriToLocalPath('file:///tmp/locus-repo');
    expect(posixPath ? normalizePathForIdentity(posixPath) : undefined).toBe('/tmp/locus-repo');

    expect(rootUriToLocalPath('https://example.com/repo')).toBeUndefined();
    expect(rootUriToLocalPath('not-a-uri')).toBeUndefined();
  });
});

describe('WorkspacePool', () => {
  it('switches cleanly between isolated project databases under LOCUS_STORAGE_ROOT', async () => {
    const root = makeTempDir();
    const storageRoot = join(root, 'storage');
    const projectA = join(root, 'proj-a');
    const projectB = join(root, 'proj-b');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writeFileSync(join(projectA, 'package.json'), '{"name":"proj-a","version":"1.0.0"}');
    writeFileSync(join(projectB, 'package.json'), '{"name":"proj-b","version":"2.0.0"}');

    process.env.LOCUS_STORAGE_ROOT = storageRoot;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;

    const pool = new WorkspacePool({
      initialCwd: projectA,
      config: { ...LOCUS_DEFAULTS },
    });

    try {
      const entryA = await pool.getOrOpenInitial();
      expect(normalizePathForIdentity(entryA.projectRoot)).toBe(normalizePathForIdentity(projectA));
      entryA.semantic.add('Project A decision', ['a'], { projectRoot: entryA.projectRoot });

      const entryB = await pool.resolveForPath(projectB);
      expect(normalizePathForIdentity(entryB.projectRoot)).toBe(normalizePathForIdentity(projectB));
      expect(entryB.dbPath).not.toBe(entryA.dbPath);
      expect(entryB.semantic.search('Project A')).toEqual([]);

      const switched = await pool.setActiveFromRootUris([
        'https://ignored.example/x',
        `file:///${projectB.replace(/\\/g, '/')}`,
      ]);
      expect(switched?.projectName).toBe('proj-b');
      expect(pool.getActive().projectName).toBe('proj-b');
      expect(pool.listEntries()).toHaveLength(2);
    } finally {
      pool.cleanupAll();
    }
  });

  it('stays pinned to the supplied DB in fixedDbPath mode', async () => {
    const root = makeTempDir();
    const projectA = join(root, 'proj-a');
    const projectB = join(root, 'proj-b');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const fixedDbPath = join(root, 'pinned.db');
    const pool = new WorkspacePool({
      initialCwd: projectA,
      fixedDbPath,
      config: { ...LOCUS_DEFAULTS },
    });

    try {
      const initial = await pool.getOrOpenInitial();
      const resolved = await pool.resolveForPath(projectB);
      const fromRoots = await pool.setActiveFromRootUris([
        `file:///${projectB.replace(/\\/g, '/')}`,
      ]);

      expect(resolved).toBe(initial);
      expect(fromRoots).toBe(initial);
      expect(pool.listEntries()).toHaveLength(1);
    } finally {
      pool.cleanupAll();
    }
  });
});

describe('multi-source pre-query sync on memory_project_state & memory_timeline', () => {
  it('ingests antigravity inbox events and extracts durable facts before memory_project_state', async () => {
    const root = makeTempDir();
    const projectDir = join(root, 'app');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), '{"name":"demo-app","version":"0.1.0"}');

    const dbPath = join(root, 'locus.db');
    const ctx = await createServer({ cwd: projectDir, dbPath });

    try {
      mkdirSync(ctx.inboxDir, { recursive: true });
      const ts = Date.now();
      const event = {
        version: 1,
        event_id: 'agy-next-step-001',
        source: 'antigravity',
        project_root: projectDir,
        session_id: 'agy-sess-1',
        timestamp: ts,
        kind: 'session_end',
        payload: {
          summary: 'Next step: wire Antigravity Stop transcript ingestion.',
        },
      };
      writeFileSync(join(ctx.inboxDir, `${ts}-agy.json`), JSON.stringify(event), 'utf8');

      const stateText = await callTextTool(ctx, 'memory_project_state', {});
      const state = JSON.parse(stateText) as MemoryProjectStateResult;

      expect(state.packageName).toBe('demo-app');
      expect(state.activeDurableCount).toBe(1);
      expect(state.nextSteps).toEqual(['Next step: wire Antigravity Stop transcript ingestion.']);
    } finally {
      ctx.cleanup();
    }
  });

  it('ingests opencode inbox events before memory_timeline on a fresh instance', async () => {
    const root = makeTempDir();
    const projectDir = join(root, 'app-timeline');
    mkdirSync(projectDir, { recursive: true });

    const dbPath = join(root, 'locus.db');
    const ctx = await createServer({ cwd: projectDir, dbPath });

    try {
      mkdirSync(ctx.inboxDir, { recursive: true });
      const ts = Date.now();
      const event = {
        version: 1,
        event_id: 'oc-timeline-001',
        source: 'opencode',
        project_root: projectDir,
        session_id: 'oc-sess-1',
        timestamp: ts,
        kind: 'tool_use',
        payload: {
          tool: 'Edit',
          files: ['src/plugin.ts'],
          status: 'success',
        },
      };
      writeFileSync(join(ctx.inboxDir, `${ts}-oc.json`), JSON.stringify(event), 'utf8');

      const timelineText = await callTextTool(ctx, 'memory_timeline', { limit: 10 });
      const timeline = JSON.parse(timelineText) as Array<{ eventId: string }>;
      expect(timeline.some((entry) => entry.eventId === 'oc-timeline-001')).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe('lazy MCP server startup', () => {
  it('defers opening SQLite for initialCwd until needed and opens only real MCP root URIs', async () => {
    const root = makeTempDir();
    const storageRoot = join(root, 'storage');
    const pluginDir = join(root, 'plugin-dir');
    const realProjectDir = join(root, 'real-project');
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(realProjectDir, { recursive: true });
    writeFileSync(join(realProjectDir, 'package.json'), '{"name":"real-proj","version":"1.0.0"}');

    process.env.LOCUS_STORAGE_ROOT = storageRoot;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_PLUGIN_ROOT;

    const lazyServer = createLazyServer({ cwd: pluginDir });
    try {
      expect(lazyServer.pool.listEntries()).toHaveLength(0);
      expect(existsSync(storageRoot)).toBe(false);

      const entry = await lazyServer.pool.setActiveFromRootUris([
        `file:///${realProjectDir.replace(/\\/g, '/')}`,
      ]);
      expect(entry?.projectName).toBe('real-project');
      expect(lazyServer.pool.listEntries()).toHaveLength(1);
      expect(readdirSync(storageRoot)).toHaveLength(1);
      expect(normalizePathForIdentity(entry?.projectRoot ?? '')).toBe(
        normalizePathForIdentity(realProjectDir),
      );
    } finally {
      lazyServer.cleanup();
    }
  });
});
