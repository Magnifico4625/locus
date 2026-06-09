import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerContext } from '../../src/server.js';
import { createServer } from '../../src/server.js';
import type {
  DurableMemoryType,
  InboxEvent,
  MemoryRecallResult,
  MemoryStatus,
} from '../../src/types.js';

const fixturesDir = join(import.meta.dirname, '..', '..', '..', 'codex', 'tests', 'fixtures');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-recall-tool-'));
  tempRoots.push(dir);
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

function writeInboxEvent(inboxDir: string, event: InboxEvent): void {
  const filename = `${event.timestamp}-${event.event_id.slice(0, 8)}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(event), 'utf8');
}

function copyFixtureSession(fixtureName: string, destination: string, projectDir: string): void {
  const source = join(fixturesDir, fixtureName);
  const lines = readFileSync(source, 'utf8')
    .split('\n')
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      const parsed = JSON.parse(line) as { type?: string; cwd?: string };
      return parsed.type === 'session_meta' ? JSON.stringify({ ...parsed, cwd: projectDir }) : line;
    });
  writeFileSync(destination, lines.join('\n'), 'utf8');
}

function insertDurableMemory(
  ctx: ServerContext,
  summary: string,
  opts?: { memoryType?: DurableMemoryType; topicKey?: string; updatedAt?: number },
): number {
  const now = opts?.updatedAt ?? Date.now();
  const result = ctx.db.run(
    `INSERT INTO durable_memories (
      topic_key, memory_type, state, summary, evidence_json,
      source_event_id, source, superseded_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts?.topicKey ?? null,
      opts?.memoryType ?? 'decision',
      'active',
      summary,
      JSON.stringify({ test: true }),
      null,
      'codex',
      null,
      now,
      now,
    ],
  );

  return result.lastInsertRowid;
}

function insertDurableDecision(
  ctx: ServerContext,
  summary: string,
  opts?: { topicKey?: string; updatedAt?: number },
): number {
  return insertDurableMemory(ctx, summary, { ...opts, memoryType: 'decision' });
}

function createYesterdayTimestamp(referenceNow: number): number {
  const startOfToday = new Date(referenceNow);
  startOfToday.setHours(0, 0, 0, 0);
  const yesterdayMidday = new Date(startOfToday);
  yesterdayMidday.setDate(yesterdayMidday.getDate() - 1);
  yesterdayMidday.setHours(12, 0, 0, 0);
  return yesterdayMidday.getTime();
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('memory_recall integration', () => {
  it('recalls explicit memories stored through memory_remember', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      await callTextTool(ctx, 'memory_remember', {
        text: 'Track C smoke decision: use redacted capture as the default practical recall mode for Codex.',
        tags: ['track-c', 'smoke'],
      });

      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What capture mode did we choose for Track C smoke?',
        limit: 5,
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.summary).toContain('redacted capture');
      expect(result.candidates).toEqual([
        expect.objectContaining({
          sourceKind: 'semantic',
          whyMatched: expect.stringContaining('explicit semantic memory'),
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });

  it('returns structured JSON recall results from ingested conversation events', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const inboxDir = join(root, 'inbox');

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    writeInboxEvent(inboxDir, {
      version: 1,
      event_id: 'recall-session-end-001',
      source: 'codex',
      project_root: projectDir,
      session_id: 'sess-recall-001',
      timestamp: Date.parse('2026-04-22T10:00:00.000Z'),
      kind: 'session_end',
      payload: {
        summary: 'Implemented auth login fixes for the dashboard.',
      },
    });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we implement?',
        limit: 5,
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result).toMatchObject({
        status: 'ok',
        question: 'What did we implement?',
      });
      expect(result.summary).toContain('Implemented auth login fixes');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        sessionId: 'sess-recall-001',
        whyMatched: 'recent conversation context',
      });
      expect(result.candidates[0]?.eventIds).toHaveLength(1);
    } finally {
      ctx.cleanup();
    }
  });

  it('answers "what did we do yesterday?" with absolute range evidence', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const inboxDir = join(root, 'inbox');
    const now = Date.now();

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    writeInboxEvent(inboxDir, {
      version: 1,
      event_id: 'recall-yesterday-001',
      source: 'codex',
      project_root: projectDir,
      session_id: 'sess-yesterday-001',
      timestamp: createYesterdayTimestamp(now),
      kind: 'session_end',
      payload: {
        summary: 'Implemented yesterday parser regression fixes.',
      },
    });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we do yesterday?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.summary).toContain('yesterday parser regression fixes');
      expect(result.resolvedRange).toMatchObject({
        label: 'yesterday',
      });
      expect(result.resolvedRange?.fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.resolvedRange?.toIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.resolvedRange?.from).toBeLessThan(result.resolvedRange?.to ?? 0);
      expect(result.candidates).toHaveLength(1);
    } finally {
      ctx.cleanup();
    }
  });

  it('answers RU "что мы делали вчера?" with absolute range evidence', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const inboxDir = join(root, 'inbox');
    const now = Date.now();

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    writeInboxEvent(inboxDir, {
      version: 1,
      event_id: 'recall-yesterday-ru-001',
      source: 'codex',
      project_root: projectDir,
      session_id: 'sess-yesterday-ru-001',
      timestamp: createYesterdayTimestamp(now),
      kind: 'session_end',
      payload: {
        summary: 'Исправили вчерашний регрессионный тест recall engine.',
      },
    });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'Что мы делали вчера?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.summary).toContain('вчерашний регрессионный тест recall engine');
      expect(result.matchedIntent).toBe('work_summary');
      expect(result.resolvedRange).toMatchObject({
        label: 'вчера',
      });
      expect(result.candidateGroups).toHaveLength(1);
    } finally {
      ctx.cleanup();
    }
  });

  it('answers durable decision recall for auth last week', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const now = Date.now();

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const durableId = insertDurableDecision(
        ctx,
        'Use GitHub OAuth as the primary authentication strategy.',
        {
          topicKey: 'auth_strategy',
          updatedAt: now - 2 * 24 * 3600 * 1000,
        },
      );

      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we decide about auth last week?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.summary).toContain('GitHub OAuth');
      expect(result.matchedIntent).toBe('decision');
      expect(result.matchedTopics).toEqual(['auth_strategy']);
      expect(result.resolvedRange).toMatchObject({
        label: 'last week',
      });
      expect(result.resolvedRange?.fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.resolvedRange?.toIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durableMemoryIds: [durableId],
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });

  it('returns durable style and preference candidates for style queries', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const durableId = insertDurableMemory(
        ctx,
        'User prefers short direct progress reports and approval gates between tasks.',
        {
          memoryType: 'style',
          topicKey: 'communication_style',
          updatedAt: Date.now(),
        },
      );

      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'Какой у меня стиль работы?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.matchedIntent).toBe('preference_style');
      expect(result.summary).toContain('short direct progress reports');
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durableMemoryIds: [durableId],
          sourceKind: 'durable',
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });

  it('answers durable rejected alternative recall', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const durableId = insertDurableMemory(
        ctx,
        'Rejected hook-first capture because it risks startup stability.',
        {
          memoryType: 'rejected_alternative',
          topicKey: 'codex_hooks_strategy',
          updatedAt: Date.now(),
        },
      );

      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'why did we reject hook-first capture?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('ok');
      expect(result.matchedIntent).toBe('rejected_alternative');
      expect(result.summary).toContain('hook-first capture');
      expect(result.candidates).toEqual([
        expect.objectContaining({
          durableMemoryIds: [durableId],
          sourceKind: 'durable',
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });

  it('answers durable next-step and validation recall', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const nextStepId = insertDurableMemory(
        ctx,
        'Next step: update the README install section after the package smoke test.',
        {
          memoryType: 'next_step',
          topicKey: 'release_steps',
          updatedAt: Date.now() - 60_000,
        },
      );
      const validationId = insertDurableMemory(
        ctx,
        'Validation passed: npm test -- packages/core/tests/memory/durable-extractor.test.ts.',
        {
          memoryType: 'validation_fact',
          topicKey: 'track_c_validation',
          updatedAt: Date.now(),
        },
      );

      const nextStepText = await callTextTool(ctx, 'memory_recall', {
        question: 'what remains to do?',
      });
      const nextStep = JSON.parse(nextStepText) as MemoryRecallResult;
      expect(nextStep.status).toBe('ok');
      expect(nextStep.matchedIntent).toBe('next_step');
      expect(nextStep.summary).toContain('README install section');
      expect(nextStep.candidates).toEqual([
        expect.objectContaining({
          durableMemoryIds: [nextStepId],
          sourceKind: 'durable',
        }),
      ]);

      const validationText = await callTextTool(ctx, 'memory_recall', {
        question: 'what passed validation?',
      });
      const validation = JSON.parse(validationText) as MemoryRecallResult;
      expect(validation.status).toBe('ok');
      expect(validation.matchedIntent).toBe('validation_fact');
      expect(validation.summary).toContain('durable-extractor.test.ts');
      expect(validation.candidates).toEqual([
        expect.objectContaining({
          durableMemoryIds: [validationId],
          sourceKind: 'durable',
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });

  it('returns needs_clarification for ambiguous two-task recall', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');
    const inboxDir = join(root, 'inbox');

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(inboxDir, { recursive: true });

    writeInboxEvent(inboxDir, {
      version: 1,
      event_id: 'recall-ambiguous-001',
      source: 'codex',
      project_root: projectDir,
      session_id: 'sess-auth',
      timestamp: Date.now() - 120_000,
      kind: 'session_end',
      payload: {
        summary: 'Implemented auth login fixes for the dashboard.',
      },
    });
    writeInboxEvent(inboxDir, {
      version: 1,
      event_id: 'recall-ambiguous-002',
      source: 'codex',
      project_root: projectDir,
      session_id: 'sess-billing',
      timestamp: Date.now() - 90_000,
      kind: 'session_end',
      payload: {
        summary: 'Implemented billing retry fixes for checkout.',
      },
    });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we implement?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result.status).toBe('needs_clarification');
      expect(result.candidates).toHaveLength(2);
      expect(result.candidateGroups).toEqual([
        expect.objectContaining({ id: 'session:sess-billing' }),
        expect.objectContaining({ id: 'session:sess-auth' }),
      ]);
      expect(result.summary).toContain('multiple possible matches');
    } finally {
      ctx.cleanup();
    }
  });

  it('returns no_memory for an empty recall query', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const dbPath = join(root, 'locus.db');

    mkdirSync(projectDir, { recursive: true });

    const ctx = await createServer({ cwd: projectDir, dbPath });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we decide about Kubernetes sharding?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;

      expect(result).toEqual({
        status: 'no_memory',
        question: 'What did we decide about Kubernetes sharding?',
        matchedIntent: 'decision',
        summary: 'No matching memory found.',
        candidates: [],
        candidateGroups: [],
      });
    } finally {
      ctx.cleanup();
    }
  });

  it('reuses the search auto-import path before returning recall results', async () => {
    const root = makeTempRoot();
    const projectDir = join(root, 'project');
    const codexHome = join(root, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions');

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    copyFixtureSession('basic-session.jsonl', join(sessionsDir, 'rollout-basic.jsonl'), projectDir);

    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexCapture = process.env.LOCUS_CODEX_CAPTURE;
    const originalCaptureLevel = process.env.LOCUS_CAPTURE_LEVEL;

    process.env.CODEX_HOME = codexHome;
    process.env.LOCUS_CODEX_CAPTURE = 'full';
    process.env.LOCUS_CAPTURE_LEVEL = 'full';

    const ctx = await createServer({ cwd: projectDir, dbPath: join(root, 'locus.db') });
    try {
      const recallText = await callTextTool(ctx, 'memory_recall', {
        question: 'What did we just complete?',
      });
      const result = JSON.parse(recallText) as MemoryRecallResult;
      const statusText = await callTextTool(ctx, 'memory_status', {});
      const status = JSON.parse(statusText) as MemoryStatus;
      const codexRows =
        ctx.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM conversation_events WHERE source = 'codex'",
        )?.cnt ?? 0;

      expect(codexRows).toBe(4);
      expect(result.status).toBe('ok');
      expect(result.summary).toContain('Parser test task completed');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.eventIds).toHaveLength(1);
      expect(status.codexAutoImport).toMatchObject({
        clientDetected: true,
        client: 'codex',
        clientSurface: 'cli',
        lastStatus: 'imported',
      });
    } finally {
      ctx.cleanup();
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalCodexCapture === undefined) {
        delete process.env.LOCUS_CODEX_CAPTURE;
      } else {
        process.env.LOCUS_CODEX_CAPTURE = originalCodexCapture;
      }
      if (originalCaptureLevel === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = originalCaptureLevel;
      }
    }
  });
});
