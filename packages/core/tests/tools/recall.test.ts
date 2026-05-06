import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleRecall } from '../../src/tools/recall.js';
import type { DatabaseAdapter, EventKind, MemoryRecallResult } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

type TestDurableMemoryType = 'decision' | 'preference' | 'style' | 'constraint';

function insertDurableMemory(
  db: DatabaseAdapter,
  summary: string,
  opts?: { memoryType?: TestDurableMemoryType; topicKey?: string; updatedAt?: number },
): number {
  const now = opts?.updatedAt ?? Date.now();
  const result = db.run(
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
  db: DatabaseAdapter,
  summary: string,
  opts?: { topicKey?: string; updatedAt?: number },
): number {
  return insertDurableMemory(db, summary, { ...opts, memoryType: 'decision' });
}

function insertConversationEvent(
  db: DatabaseAdapter,
  opts: {
    eventId: string;
    kind?: EventKind;
    timestamp: number;
    payloadJson: string;
    sessionId?: string;
    source?: string;
  },
): void {
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      opts.source ?? 'codex',
      null,
      'C:/Projects/Locus',
      opts.sessionId ?? 'sess-1',
      opts.timestamp,
      opts.kind ?? 'session_end',
      opts.payloadJson,
      'high',
      null,
      opts.timestamp,
    ],
  );
}

describe('handleRecall', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;
  const now = Date.parse('2026-04-22T12:00:00.000Z');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-recall-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves "yesterday" to an absolute date range', () => {
    const result = handleRecall('What did we do yesterday?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('no_memory');
    expect(result.question).toBe('What did we do yesterday?');
    expect(result.resolvedRange).toEqual({
      label: 'yesterday',
      from: Date.parse('2026-04-21T00:00:00.000Z'),
      to: Date.parse('2026-04-22T00:00:00.000Z'),
      fromIso: '2026-04-21T00:00:00.000Z',
      toIso: '2026-04-22T00:00:00.000Z',
    });
  });

  it('includes durable decision memory in the returned summary and candidates', () => {
    const durableId = insertDurableDecision(
      adapter,
      'Use GitHub OAuth as the primary authentication strategy.',
      { topicKey: 'auth_strategy', updatedAt: now - 3_600_000 },
    );

    const result = handleRecall('What did we decide about auth last week?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('ok');
    expect(result.resolvedRange).toEqual({
      label: 'last week',
      from: now - 7 * 24 * 3600 * 1000,
      to: now,
      fromIso: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
      toIso: new Date(now).toISOString(),
    });
    expect(result.summary).toContain('GitHub OAuth');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        durableMemoryIds: [durableId],
      }),
    ]);
  });

  it('includes recent conversation context in the returned summary and candidates', () => {
    insertConversationEvent(adapter, {
      eventId: 'evt-bugfix-1',
      timestamp: now - 60_000,
      kind: 'session_end',
      payloadJson: JSON.stringify({
        summary: 'Fixed the durable runner watermark bug in Codex import.',
      }),
      sessionId: 'sess-bugfix',
    });

    const result = handleRecall('What did we just fix?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('watermark bug');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        sessionId: 'sess-bugfix',
        eventIds: ['evt-bugfix-1'],
      }),
    ]);
  });

  it('finds matching conversation context even when it is older than the recent timeline window', () => {
    insertConversationEvent(adapter, {
      eventId: 'evt-tracka-live-marker',
      timestamp: now - 30 * 60_000,
      kind: 'user_prompt',
      payloadJson: JSON.stringify({
        prompt:
          'TRACKA-LIVE-20260423 decision: use SQLite cache and redacted capture for live recall.',
      }),
      sessionId: 'sess-tracka-live',
    });

    for (let index = 0; index < 12; index++) {
      insertConversationEvent(adapter, {
        eventId: `evt-newer-${index}`,
        timestamp: now - index * 60_000,
        kind: 'session_end',
        payloadJson: JSON.stringify({
          summary: `Newer unrelated task ${index}.`,
        }),
        sessionId: `sess-newer-${index}`,
      });
    }

    const result = handleRecall('What did we decide for TRACKA-LIVE-20260423?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('SQLite cache');
    expect(result.summary).toContain('redacted capture');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        sessionId: 'sess-tracka-live',
        eventIds: ['evt-tracka-live-marker'],
      }),
    ]);
  });

  it('returns needs_clarification when multiple distinct recall candidates match', () => {
    insertConversationEvent(adapter, {
      eventId: 'evt-task-1',
      timestamp: now - 120_000,
      kind: 'session_end',
      payloadJson: JSON.stringify({
        summary: 'Implemented auth login fixes for the dashboard.',
      }),
      sessionId: 'sess-auth',
    });
    insertConversationEvent(adapter, {
      eventId: 'evt-task-2',
      timestamp: now - 90_000,
      kind: 'session_end',
      payloadJson: JSON.stringify({
        summary: 'Implemented billing retry fixes for checkout.',
      }),
      sessionId: 'sess-billing',
    });

    const result = handleRecall('What did we implement?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('needs_clarification');
    expect(result.candidates).toHaveLength(2);
    expect(result).toMatchObject({
      status: 'needs_clarification',
      question: expect.any(String),
      summary: expect.any(String),
      candidates: expect.any(Array),
      candidateGroups: expect.any(Array),
    });
    expect(result.candidateGroups).toEqual([
      expect.objectContaining({
        id: 'session:sess-billing',
        heading: expect.stringContaining('billing retry fixes'),
        candidates: [expect.objectContaining({ sessionId: 'sess-billing' })],
      }),
      expect.objectContaining({
        id: 'session:sess-auth',
        heading: expect.stringContaining('auth login fixes'),
        candidates: [expect.objectContaining({ sessionId: 'sess-auth' })],
      }),
    ]);
  });

  it('loads durable preference, style, and constraint memories for preference/style queries', () => {
    const preferenceId = insertDurableMemory(adapter, 'Prefer one task at a time with approval gates.', {
      memoryType: 'preference',
      topicKey: 'user_workflow_style',
      updatedAt: now - 60_000,
    });
    const styleId = insertDurableMemory(adapter, 'User likes concise factual progress updates.', {
      memoryType: 'style',
      topicKey: 'user_workflow_style',
      updatedAt: now - 120_000,
    });
    const constraintId = insertDurableMemory(adapter, 'Do not touch unrelated Claude Code files.', {
      memoryType: 'constraint',
      topicKey: 'claude_code_compatibility',
      updatedAt: now - 180_000,
    });

    const result = handleRecall('какой у меня стиль работы?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('needs_clarification');
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ durableMemoryIds: [preferenceId], sourceKind: 'durable' }),
        expect.objectContaining({ durableMemoryIds: [styleId], sourceKind: 'durable' }),
        expect.objectContaining({ durableMemoryIds: [constraintId], sourceKind: 'durable' }),
      ]),
    );
  });

  it('loads user prompts, assistant responses, and session summaries as conversation candidates', () => {
    insertConversationEvent(adapter, {
      eventId: 'evt-user-npm',
      timestamp: now - 60_000,
      kind: 'user_prompt',
      payloadJson: JSON.stringify({ prompt: 'npm install failed with a workspace lock issue.' }),
      sessionId: 'sess-user',
    });
    insertConversationEvent(adapter, {
      eventId: 'evt-assistant-npm',
      timestamp: now - 120_000,
      kind: 'ai_response',
      payloadJson: JSON.stringify({ response: 'Root cause: npm install failed because package-lock was stale.' }),
      sessionId: 'sess-assistant',
    });
    insertConversationEvent(adapter, {
      eventId: 'evt-summary-npm',
      timestamp: now - 180_000,
      kind: 'session_end',
      payloadJson: JSON.stringify({ summary: 'Fixed npm install by refreshing workspace dependencies.' }),
      sessionId: 'sess-summary',
    });

    const result = handleRecall('which npm install errors happened?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('needs_clarification');
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventIds: ['evt-user-npm'], sourceKind: 'conversation' }),
        expect.objectContaining({ eventIds: ['evt-assistant-npm'], sourceKind: 'conversation' }),
        expect.objectContaining({ eventIds: ['evt-summary-npm'], sourceKind: 'conversation' }),
      ]),
    );
  });

  it('matches Russian stem-lite query variants against conversation payload text', () => {
    insertConversationEvent(adapter, {
      eventId: 'evt-russian-error',
      timestamp: now - 60_000,
      kind: 'user_prompt',
      payloadJson: JSON.stringify({ prompt: 'Починили ошибку npm install в workspace.' }),
      sessionId: 'sess-russian',
    });

    const result = handleRecall('какие были ошибки при npm install?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('ошибку npm install');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        eventIds: ['evt-russian-error'],
        matchedTerms: expect.arrayContaining(['ошибк', 'npm', 'install']),
      }),
    ]);
  });

  it('returns no_memory when neither durable nor conversation context matches', () => {
    const result = handleRecall('What did we decide about Kubernetes sharding?', {
      db: adapter,
      now,
    }) as MemoryRecallResult;

    expect(result).toEqual({
      status: 'no_memory',
      question: 'What did we decide about Kubernetes sharding?',
      matchedIntent: 'decision',
      summary: 'No matching memory found.',
      candidates: [],
      candidateGroups: [],
    });
  });
});
