import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLocalDateKey, initStorage } from '@locus/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLocusDshPlugin,
  inject as dshInject,
  name as dshPluginName,
  resolveDshProjectStorageDir,
} from '../src/dsh/plugin.js';
import type {
  DshContext,
  DshMcpServerEntry,
  DshMessage,
  DshPreStepArgs,
  DshPreStepDecision,
  DshSession,
  DshSessionEvent,
  DshToolExec,
  DshToolResult,
} from '../src/dsh/plugin-types.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'locus-dsh-plugin-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface MockHarnessOptions {
  hasMcpManager?: boolean;
  onMcpRegister?: (serverName: string, entry: DshMcpServerEntry) => void;
  getWorkingDirectory?: (session: DshSession) => string;
}

function createMockDshContext(options: MockHarnessOptions = {}) {
  const sections: Array<{ name: string; order: number; text: string; interpolate?: boolean }> = [];
  const warnings: string[] = [];
  const registeredMcps: Array<{ name: string; entry: DshMcpServerEntry }> = [];
  const preStepListeners: Array<
    (args: DshPreStepArgs, next: () => Promise<DshPreStepDecision>) => Promise<DshPreStepDecision>
  > = [];
  const sessionEventListeners: Array<(session: DshSession, event: DshSessionEvent) => void> = [];
  const toolResultListeners: Array<(exec: DshToolExec, result: DshToolResult) => void> = [];
  const effectCleanups: Array<() => void | Promise<void>> = [];

  const ctx: DshContext = {
    systemPrompt: {
      section(section) {
        sections.push(section);
      },
    },
    workingDirectory: {
      get(session) {
        if (options.getWorkingDirectory) {
          return options.getWorkingDirectory(session);
        }
        return session.header?.cwd ?? '';
      },
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    on(event: string, listener: unknown) {
      if (event === 'agent/pre-step') {
        preStepListeners.push(
          listener as (
            args: DshPreStepArgs,
            next: () => Promise<DshPreStepDecision>,
          ) => Promise<DshPreStepDecision>,
        );
      } else if (event === 'session/event') {
        sessionEventListeners.push(
          listener as (session: DshSession, event: DshSessionEvent) => void,
        );
      } else if (event === 'tools/result') {
        toolResultListeners.push(listener as (exec: DshToolExec, result: DshToolResult) => void);
      }
    },
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === 'function') {
        effectCleanups.push(cleanup);
      }
    },
    inject(services, callback) {
      if (services.includes('mcpManager') && options.hasMcpManager !== false) {
        callback({
          ...ctx,
          mcpManager: {
            register(serverName, entry) {
              options.onMcpRegister?.(serverName, entry);
              registeredMcps.push({ name: serverName, entry });
              return () => {};
            },
          },
        });
      }
    },
  };

  async function runPreStep(args: DshPreStepArgs): Promise<DshPreStepDecision> {
    let idx = 0;
    const next = async (): Promise<DshPreStepDecision> => {
      const listener = preStepListeners[idx++];
      if (listener) {
        return listener(args, next);
      }
      return { kind: 'enter', messages: [...args.messages] };
    };
    return next();
  }

  function emitSessionEvent(session: DshSession, event: DshSessionEvent): void {
    for (const listener of sessionEventListeners) {
      listener(session, event);
    }
  }

  function emitToolResult(exec: DshToolExec, result: DshToolResult): void {
    for (const listener of toolResultListeners) {
      listener(exec, result);
    }
  }

  async function dispose(): Promise<void> {
    for (const cleanup of effectCleanups) {
      await cleanup();
    }
  }

  return {
    ctx,
    sections,
    warnings,
    registeredMcps,
    runPreStep,
    emitSessionEvent,
    emitToolResult,
    dispose,
  };
}

function makeHumanMessage(id: string, text: string): DshMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

describe('DeepSeek Harness Cordis plugin (locus-memory-dsh)', () => {
  it('exports standard Cordis name/inject, registers prompt section without interpolation, and respects optional mcpManager', () => {
    expect(dshPluginName).toBe('locus-memory');
    expect(dshInject).toEqual(['agents', 'workingDirectory', 'systemPrompt']);

    const root = makeTempDir();
    const serverPath = join(root, 'runtime', 'server.js');
    const primaryRuntime = join(root, 'primary-runtime');
    const runtimeNodeDir = join(primaryRuntime, 'dependencies', 'node', 'bin');
    mkdirSync(join(root, 'runtime'), { recursive: true });
    mkdirSync(runtimeNodeDir, { recursive: true });
    writeFileSync(serverPath, '// mock server\n', 'utf8');
    const expectedExe = join(runtimeNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');
    writeFileSync(expectedExe, '', 'utf8');

    const withMcp = createMockDshContext();
    applyLocusDshPlugin(
      withMcp.ctx,
      { captureLevel: 'redacted', enableMcp: true },
      {
        env: { DSH_PRIMARY_RUNTIME: primaryRuntime, LOCUS_HOME: join(root, '.locus') },
        defaultServerPath: serverPath,
      },
    );

    expect(withMcp.sections).toHaveLength(1);
    expect(withMcp.sections[0]?.name).toBe('locus-memory:instructions');
    expect(withMcp.sections[0]?.interpolate).toBe(false);
    expect(withMcp.registeredMcps).toHaveLength(1);
    expect(withMcp.registeredMcps[0]).toMatchObject({
      name: 'locus',
      entry: {
        transport: 'stdio',
        command: expectedExe,
        args: [serverPath],
        env: {
          LOCUS_CLIENT: 'dsh',
          LOCUS_CLIENT_SURFACE: 'desktop',
          LOCUS_CAPTURE_LEVEL: 'redacted',
        },
      },
    });

    // Headless profile: no mcpManager
    const headless = createMockDshContext({ hasMcpManager: false });
    applyLocusDshPlugin(
      headless.ctx,
      { enableMcp: true },
      {
        env: { LOCUS_HOME: join(root, '.locus') },
        defaultServerPath: serverPath,
      },
    );
    expect(headless.sections).toHaveLength(1);
    expect(headless.registeredMcps).toEqual([]);

    // Duplicate user-configured MCP server fails open with warning
    const duplicate = createMockDshContext({
      onMcpRegister: () => {
        throw new Error('mcp-manager: server "locus" is already configured');
      },
    });
    applyLocusDshPlugin(
      duplicate.ctx,
      { enableMcp: true },
      {
        env: { LOCUS_HOME: join(root, '.locus') },
        defaultServerPath: serverPath,
      },
    );
    expect(duplicate.warnings.some((w) => w.includes('already configured'))).toBe(true);
  });

  it('denies markerless directories and ~/.dsh without creating any storage files', async () => {
    const root = makeTempDir();
    const locusHome = join(root, '.locus');
    const storageRoot = join(root, 'memory');
    const markerlessDir = join(root, 'random-folder');
    mkdirSync(markerlessDir, { recursive: true });
    mkdirSync(locusHome, { recursive: true });

    const harness = createMockDshContext();
    const handle = applyLocusDshPlugin(
      harness.ctx,
      { enableMcp: false },
      {
        env: { LOCUS_HOME: locusHome, LOCUS_STORAGE_ROOT: storageRoot },
      },
    );

    const session: DshSession = { id: 'sess-denied', header: { cwd: markerlessDir } };
    const decision = await harness.runPreStep({
      agent: { session },
      messages: [makeHumanMessage('u1', 'DSH-DENY используем SQLite для всего.')],
      turn: 1,
      step: 1,
    });
    harness.emitSessionEvent(session, {
      seq: 1,
      type: 'user/message',
      surfaceOp: 'append',
      data: makeHumanMessage('u1', 'DSH-DENY используем SQLite для всего.'),
    });
    harness.emitSessionEvent(session, { seq: 2, type: 'turn/end' });
    await handle.flushAll();

    expect(decision.messages).toHaveLength(1);
    expect(existsSync(storageRoot)).toBe(false);
    expect(existsSync(join(locusHome, 'state', 'dsh'))).toBe(false);
  });

  it('captures session events + mutating tools, writes daily journal, and injects zero-call brief across sessions without self-injection', async () => {
    const root = makeTempDir();
    const projectDir = join(root, 'my-dsh-app');
    const locusHome = join(root, '.locus');
    const storageRoot = join(root, 'memory');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(locusHome, { recursive: true });
    writeFileSync(
      join(projectDir, 'package.json'),
      '{"name":"my-dsh-app","version":"1.2.3"}',
      'utf8',
    );

    const env = {
      LOCUS_HOME: locusHome,
      LOCUS_STORAGE_ROOT: storageRoot,
      LOCUS_ALLOW_TEMP_WORKSPACE: '1',
    };

    const fixedNow = new Date('2026-11-27T11:15:00.000Z').getTime();
    const dateKey = formatLocalDateKey(fixedNow);
    const harness1 = createMockDshContext({ hasMcpManager: false });
    const handle1 = applyLocusDshPlugin(
      harness1.ctx,
      { captureLevel: 'redacted', enableMcp: false },
      { env, now: () => fixedNow },
    );

    const session1: DshSession = { id: 'dsh-s1', header: { cwd: projectDir } };
    const turn1Prompt =
      'Решение: DSH-LIVE-V4 выбрали PostgreSQL + pgvector для векторного индекса в DSH.';

    // Turn 1 pre-step (empty memory -> no injection)
    const pre1 = await harness1.runPreStep({
      agent: { session: session1, options: { model: 'deepseek-flash' } },
      messages: [makeHumanMessage('m1', turn1Prompt)],
      turn: 1,
      step: 1,
    });
    expect(pre1.messages).toHaveLength(1);

    // Emit real user/message event
    harness1.emitSessionEvent(session1, {
      seq: 10,
      type: 'user/message',
      time: fixedNow,
      surfaceOp: 'append',
      data: makeHumanMessage('m1', turn1Prompt),
    });

    // Self-injection echo guard: locus-memory message MUST NOT be captured as human prompt
    harness1.emitSessionEvent(session1, {
      seq: 11,
      type: 'user/message',
      time: fixedNow,
      surfaceOp: 'append',
      data: {
        id: 'm-injected',
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<system-reminder>\n[Locus Memory — Project Brief]\nFake self-echo\n</system-reminder>',
          },
        ],
        source: { kind: 'locus-memory' },
      },
    });

    // Tools: mutating edit + failing read + read-only read + locus MCP call
    harness1.emitToolResult(
      {
        name: 'edit',
        callId: 'call-edit-1',
        arguments: { file_path: join(projectDir, 'src', 'db.ts') },
        agent: { session: session1 },
      },
      { isError: false },
    );
    harness1.emitToolResult(
      {
        name: 'read',
        callId: 'call-read-ok',
        arguments: { file_path: join(projectDir, 'README.md') },
        agent: { session: session1 },
      },
      { isError: false },
    );
    harness1.emitToolResult(
      {
        name: 'pwsh',
        callId: 'call-pwsh-err',
        arguments: { command: 'npm test' },
        agent: { session: session1 },
      },
      { isError: true },
    );
    harness1.emitToolResult(
      {
        name: 'locus__memory_recall',
        callId: 'call-locus',
        arguments: { question: 'db?' },
        agent: { session: session1 },
      },
      { isError: false },
    );

    // Assistant message with reasoning block + text block (reasoning must be ignored!)
    harness1.emitSessionEvent(session1, {
      seq: 12,
      type: 'assistant/message',
      time: fixedNow + 1000,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 2,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'SECRET_REASONING_THOUGHT должен игнорироваться.' },
            {
              type: 'text',
              text: 'Принято. Обновил конфигурацию хранения в src/db.ts и настроил Kibana metrics pipeline.',
            },
          ],
          source: { kind: 'model', model: 'deepseek-flash' },
        },
      },
    });

    // End turn -> trigger flush
    harness1.emitSessionEvent(session1, {
      seq: 13,
      type: 'turn/end',
      time: fixedNow + 2000,
    });
    await handle1.flushAll();

    // Verify SQLite storage & daily journal
    const storageDir = resolveDshProjectStorageDir(projectDir, env);
    const dbPath = join(storageDir, 'locus.db');
    expect(existsSync(dbPath)).toBe(true);
    const journalPath = join(storageDir, 'journal', `${dateKey}.md`);
    expect(existsSync(journalPath)).toBe(true);
    expect(existsSync(join(storageDir, 'journal', 'INDEX.md'))).toBe(true);
    const journalMd = readFileSync(journalPath, 'utf8');
    expect(journalMd).toContain('DSH-LIVE-V4');

    const { db } = await initStorage(dbPath);
    try {
      const decisions = db.all<{ summary: string; source: string }>(
        "SELECT summary, source FROM durable_memories WHERE memory_type = 'decision' AND state = 'active'",
      );
      expect(decisions).toHaveLength(1);
      expect(decisions[0]?.source).toBe('dsh');
      expect(decisions[0]?.summary).toContain('PostgreSQL');

      const events = db.all<{ kind: string; payload_json: string | null }>(
        'SELECT kind, payload_json FROM conversation_events ORDER BY id ASC',
      );
      const serialized = events.map((e) => e.payload_json ?? '').join('\n');
      expect(serialized).not.toContain('SECRET_REASONING_THOUGHT');
      expect(serialized).not.toContain('Fake self-echo');
      expect(serialized).not.toContain('locus__memory_recall');
      expect(serialized).not.toContain('README.md');
      expect(serialized).toContain('db.ts');
      expect(
        events.some((e) => e.kind === 'tool_use' && (e.payload_json ?? '').includes('error')),
      ).toBe(true);
      expect(events.some((e) => e.kind === 'ai_response')).toBe(true);
    } finally {
      db.close();
    }

    // Session 2: brand new session -> automatic zero-call Project Brief + dedup checks
    const harness2 = createMockDshContext({ hasMcpManager: false });
    const handle2 = applyLocusDshPlugin(
      harness2.ctx,
      { captureLevel: 'redacted', enableMcp: false },
      { env, now: () => fixedNow + 60_000 },
    );

    const session2: DshSession = { id: 'dsh-s2', header: { cwd: projectDir } };
    const pre2Turn1 = await harness2.runPreStep({
      agent: { session: session2 },
      messages: [makeHumanMessage('s2-u1', 'Какую БД выбрали для векторного индекса?')],
      turn: 1,
      step: 1,
    });
    expect(pre2Turn1.messages).toHaveLength(2);
    const injectedMsg = pre2Turn1.messages[1];
    expect(injectedMsg?.role).toBe('user');
    expect(injectedMsg?.source?.kind).toBe('locus-memory');
    const injectedText = injectedMsg?.content[0]?.text ?? '';
    expect(injectedText).toContain('<system-reminder>');
    expect(injectedText).toContain('[Locus Memory — Project Brief]');
    expect(injectedText).toContain('PostgreSQL');
    expect(injectedText).toContain('Recent Days:');

    // Noisy continuation prompt must not inject extra context
    const pre2Noisy = await harness2.runPreStep({
      agent: { session: session2 },
      messages: [makeHumanMessage('s2-u2', 'ок')],
      turn: 2,
      step: 1,
    });
    expect(pre2Noisy.messages).toHaveLength(1);

    // Duplicate prompt hash in the same session must not re-inject
    const pre2Dup = await harness2.runPreStep({
      agent: { session: session2 },
      messages: [makeHumanMessage('s2-u3', '  ок  ')],
      turn: 3,
      step: 1,
    });
    expect(pre2Dup.messages).toHaveLength(1);

    // Targeted prompt about earlier non-durable event injects Relevant Recall cleanly
    const pre2Recall = await harness2.runPreStep({
      agent: { session: session2 },
      messages: [makeHumanMessage('s2-u4', 'Что настроили для Kibana metrics pipeline?')],
      turn: 4,
      step: 1,
    });
    expect(pre2Recall.messages).toHaveLength(2);
    const recallText = pre2Recall.messages[1]?.content[0]?.text ?? '';
    expect(recallText).toContain('[Locus Memory — Relevant Recall]');
    expect(recallText).toContain('Kibana');
    expect(recallText).not.toContain('DSH-LIVE-V4');

    await handle2.flushAll();
  });

  it('respects metadata capture mode by blocking prompt and assistant text capture', async () => {
    const root = makeTempDir();
    const projectDir = join(root, 'meta-dsh-app');
    const locusHome = join(root, '.locus');
    const storageRoot = join(root, 'memory');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), '{"name":"meta-dsh-app"}', 'utf8');

    const env = {
      LOCUS_HOME: locusHome,
      LOCUS_STORAGE_ROOT: storageRoot,
      LOCUS_ALLOW_TEMP_WORKSPACE: '1',
    };

    const harness = createMockDshContext({ hasMcpManager: false });
    const handle = applyLocusDshPlugin(
      harness.ctx,
      { captureLevel: 'metadata', enableMcp: false },
      { env, now: () => 1_795_000_000_000 },
    );

    const session: DshSession = { id: 'meta-s1', header: { cwd: projectDir } };
    await harness.runPreStep({
      agent: { session },
      messages: [makeHumanMessage('m1', 'секретный текст промта')],
      turn: 1,
      step: 1,
    });
    harness.emitSessionEvent(session, {
      seq: 1,
      type: 'user/message',
      surfaceOp: 'append',
      data: makeHumanMessage('m1', 'секретный текст промта'),
    });
    harness.emitSessionEvent(session, {
      seq: 2,
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'секретный ответ модели' }],
        },
      },
    });
    harness.emitToolResult(
      {
        name: 'write',
        callId: 'c1',
        arguments: { file_path: join(projectDir, 'index.ts') },
        agent: { session },
      },
      { isError: false },
    );
    await handle.flushAll();

    const dbPath = join(resolveDshProjectStorageDir(projectDir, env), 'locus.db');
    const { db } = await initStorage(dbPath);
    try {
      const kinds = db
        .all<{ kind: string }>('SELECT kind FROM conversation_events ORDER BY id ASC')
        .map((row) => row.kind);
      expect(kinds).toContain('session_start');
      expect(kinds).toContain('tool_use');
      expect(kinds).not.toContain('user_prompt');
      expect(kinds).not.toContain('ai_response');
    } finally {
      db.close();
    }
  });
});
