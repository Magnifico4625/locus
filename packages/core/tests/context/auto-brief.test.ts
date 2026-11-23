import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPromptRecallBrief,
  buildSessionStartBrief,
  isNoisyPrompt,
} from '../../src/context/auto-brief.js';
import { DurableMemoryStore } from '../../src/memory/durable.js';
import { SemanticMemory } from '../../src/memory/semantic.js';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

describe('Zero-Call Context Brief Engine (auto-brief)', () => {
  let tempDir: string;
  let projectDir: string;
  let otherProjectDir: string;
  let db: NodeSqliteAdapter;
  let store: DurableMemoryStore;
  let semantic: SemanticMemory;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-auto-brief-'));
    projectDir = join(tempDir, 'my-app');
    otherProjectDir = join(tempDir, 'other-app');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(otherProjectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.2.3' }),
      'utf8',
    );
    db = createAdapter(tempDir);
    runMigrations(db, true);
    store = new DurableMemoryStore(db, true);
    semantic = new SemanticMemory(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isNoisyPrompt', () => {
    it('filters short EN/RU acknowledgements, slash commands, and whitespace', () => {
      for (const noisy of [
        '',
        '   ',
        'ok',
        'OK!',
        'yes.',
        'continue',
        'sounds good',
        'да',
        'Да.',
        'ок',
        'продолжай',
        'дальше',
        'спасибо!',
        '1. да 2. да',
        '1) yes 2) ok',
        '/compact',
        '/clear',
        'hi',
        'тест',
      ]) {
        expect(isNoisyPrompt(noisy), `expected noisy: ${JSON.stringify(noisy)}`).toBe(true);
      }
    });

    it('keeps real coding prompts, questions, and short file/path queries', () => {
      for (const meaningful of [
        'auth.ts',
        'src/db',
        'почему?',
        '1. да 2. проверь auth.ts',
        'What did we decide about PostgreSQL vs SQLite?',
        'Исправь баг авторизации в login.ts',
        '/remember use SQLite for local memory',
      ]) {
        expect(
          isNoisyPrompt(meaningful),
          `expected meaningful: ${JSON.stringify(meaningful)}`,
        ).toBe(false);
      }
    });
  });

  describe('buildSessionStartBrief', () => {
    it('returns empty_memory when the project has no stored knowledge', () => {
      const brief = buildSessionStartBrief({
        db,
        projectRoot: projectDir,
        readGitState: () => ({ gitBranch: 'main', gitHead: 'abc1234', dirty: false }),
      });

      expect(brief).toEqual({
        mode: 'session_start',
        injected: false,
        reason: 'empty_memory',
        text: '',
        estimatedTokens: 0,
        includedDurableIds: [],
        includedEventIds: [],
      });
    });

    it('builds an isolated, token-bounded brief with decisions, constraints, next steps, and recent files', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      const scopedOther = normalizeProjectRootForScope(otherProjectDir);

      const dec1 = store.insert({
        topicKey: 'database_choice',
        memoryType: 'decision',
        summary: 'Use SQLite with WAL mode instead of Postgres for local-first storage.',
        evidence: { confidence: 0.95 },
        projectRoot: scopedProject,
        source: 'codex',
      });
      const decOther = store.insert({
        topicKey: 'database_choice',
        memoryType: 'decision',
        summary: 'Secret other-app MongoDB decision that must never leak.',
        evidence: { confidence: 0.95 },
        projectRoot: scopedOther,
        source: 'codex',
      });
      const pref1 = store.insert({
        memoryType: 'constraint',
        summary: 'Do not modify legacy packages/claude-code hooks.',
        evidence: { confidence: 0.9 },
        projectRoot: scopedProject,
        source: 'antigravity',
      });
      const step1 = store.insert({
        memoryType: 'next_step',
        summary: 'Implement Antigravity PreInvocation hook adapter.',
        evidence: { confidence: 0.88 },
        projectRoot: scopedProject,
        source: 'opencode',
      });

      const ts = Date.now();
      db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-1',
          'antigravity',
          null,
          scopedProject,
          's1',
          ts,
          'tool_use',
          '{"tool":"Edit","files":["src/server.ts"]}',
          'medium',
          null,
          ts,
        ],
      );
      db.run('INSERT INTO event_files (event_id, file_path) VALUES (?, ?)', [
        'evt-1',
        'src/server.ts',
      ]);

      const brief = buildSessionStartBrief(
        {
          db,
          projectRoot: projectDir,
          readGitState: () => ({ gitBranch: 'feat/v4', gitHead: '1234567', dirty: true }),
        },
        { maxTokens: 500 },
      );

      expect(brief.injected).toBe(true);
      expect(brief.reason).toBe('ok');
      expect(brief.estimatedTokens).toBeLessThanOrEqual(500);
      expect(brief.text).toContain('[Locus Memory — Project Brief]');
      expect(brief.text).toContain('Project: my-app | v1.2.3 | branch=feat/v4 | dirty');
      expect(brief.text).toContain('Use SQLite with WAL mode');
      expect(brief.text).toContain('Do not modify legacy packages/claude-code hooks.');
      expect(brief.text).toContain('Implement Antigravity PreInvocation hook adapter.');
      expect(brief.text).toContain('Recent Files: src/server.ts');
      expect(brief.text).not.toContain('Secret other-app MongoDB');
      expect(brief.includedDurableIds).toEqual([dec1.id, pref1.id, step1.id]);
      expect(brief.includedDurableIds).not.toContain(decOther.id);
    });

    it('falls back to semantic memories when durable decisions are absent and respects maxTokens', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      for (let i = 1; i <= 5; i++) {
        semantic.add(
          `Semantic architecture note #${i}: keep adapter boundaries thin and well tested across all desktop platforms.`,
          ['arch'],
          { projectRoot: scopedProject },
        );
      }

      const brief = buildSessionStartBrief(
        {
          db,
          projectRoot: projectDir,
          readGitState: () => ({ gitBranch: 'main' }),
        },
        { maxTokens: 80 },
      );

      expect(brief.injected).toBe(true);
      expect(brief.estimatedTokens).toBeLessThanOrEqual(80);
      expect(brief.text).toContain('Semantic architecture note');
    });
  });

  describe('buildPromptRecallBrief', () => {
    it('returns noise_filtered on acknowledgements without querying recall', () => {
      const brief = buildPromptRecallBrief('продолжай', { db, projectRoot: projectDir });
      expect(brief.injected).toBe(false);
      expect(brief.reason).toBe('noise_filtered');
    });

    it('returns empty_memory when no matching memory exists', () => {
      const brief = buildPromptRecallBrief('What did we decide about Redis caching?', {
        db,
        projectRoot: projectDir,
      });
      expect(brief.injected).toBe(false);
      expect(brief.reason).toBe('empty_memory');
    });

    it('returns relevant project-isolated recall and deduplicates previously injected memories', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      const scopedOther = normalizeProjectRootForScope(otherProjectDir);
      const now = Date.parse('2026-06-20T12:00:00.000Z');

      const authDecision = store.insert({
        topicKey: 'auth_strategy',
        memoryType: 'decision',
        summary: 'Use JWT access tokens with short-lived refresh rotation for API auth.',
        evidence: { confidence: 0.94 },
        projectRoot: scopedProject,
        source: 'codex',
      });
      store.insert({
        topicKey: 'auth_strategy',
        memoryType: 'decision',
        summary: 'Other project auth uses OAuth2 SAML.',
        evidence: { confidence: 0.94 },
        projectRoot: scopedOther,
        source: 'codex',
      });

      const first = buildPromptRecallBrief(
        'What did we decide about auth strategy?',
        { db, projectRoot: projectDir, now },
        { maxTokens: 300, maxItems: 3 },
      );

      expect(first.injected).toBe(true);
      expect(first.reason).toBe('ok');
      expect(first.text).toContain('[Locus Memory — Relevant Recall]');
      expect(first.text).toContain('JWT access tokens');
      expect(first.text).not.toContain('OAuth2 SAML');
      expect(first.includedDurableIds).toContain(authDecision.id);

      const second = buildPromptRecallBrief(
        'What did we decide about auth strategy?',
        { db, projectRoot: projectDir, now },
        { alreadyInjectedDurableIds: first.includedDurableIds },
      );

      expect(second.injected).toBe(false);
      expect(second.reason).toBe('already_injected');
    });

    it('respects minConfidence=high and maxTokens/maxItems caps', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      const now = Date.parse('2026-06-20T12:00:00.000Z');
      const oldTs = now - 60 * 24 * 60 * 60 * 1000;

      // Insert an aged legacy global semantic memory (scores 7 -> confidence 'medium')
      db.run(
        `INSERT INTO memories (layer, content, tags_json, project_root, created_at, updated_at)
         VALUES ('semantic', ?, '[]', NULL, ?, ?)`,
        ['Legacy telemetry naming convention note.', oldTs, oldTs],
      );

      const strictBrief = buildPromptRecallBrief(
        'What did we decide about telemetry?',
        { db, projectRoot: projectDir, now },
        { minConfidence: 'high' },
      );
      expect(strictBrief.injected).toBe(false);
      expect(strictBrief.reason).toBe('low_confidence');

      const mediumBrief = buildPromptRecallBrief(
        'What did we decide about telemetry?',
        { db, projectRoot: projectDir, now },
        { minConfidence: 'medium' },
      );
      expect(mediumBrief.injected).toBe(true);

      // Now add 3 recent durable decisions and cap maxItems=1 and maxTokens=70
      for (let i = 1; i <= 3; i++) {
        store.insert({
          memoryType: 'decision',
          summary: `Telemetry pipeline decision #${i}: emit structured metrics locally.`,
          evidence: { confidence: 0.9 },
          projectRoot: scopedProject,
          source: 'dsh',
        });
      }

      const capped = buildPromptRecallBrief(
        'What did we decide about telemetry?',
        { db, projectRoot: projectDir, now },
        { maxItems: 1, maxTokens: 70 },
      );

      expect(capped.injected).toBe(true);
      expect(capped.estimatedTokens).toBeLessThanOrEqual(70);
      expect(capped.includedDurableIds).toHaveLength(1);
    });

    it('deduplicates originating conversation events via source_event_id across session-start and prompt recall', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      const now = Date.parse('2026-06-20T12:00:00.000Z');
      const sourceEventId = 'evt-origin-redis-1';

      db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sourceEventId,
          'antigravity',
          'antigravity:conv:step:0',
          scopedProject,
          'conv-1',
          now - 1000,
          'ai_response',
          JSON.stringify({
            response: 'Decision: use Redis Cluster for distributed rate limiting.',
            capture_policy: 'bounded_redacted',
          }),
          'high',
          '["redis"]',
          now - 1000,
        ],
      );

      const dec = store.insert({
        topicKey: 'general',
        memoryType: 'decision',
        summary: 'use Redis Cluster for distributed rate limiting.',
        evidence: { confidence: 0.9 },
        projectRoot: scopedProject,
        sourceEventId,
        source: 'antigravity',
      });

      const start = buildSessionStartBrief({
        db,
        projectRoot: projectDir,
        now,
        readGitState: () => ({ gitBranch: 'main' }),
      });

      expect(start.injected).toBe(true);
      expect(start.includedDurableIds).toContain(dec.id);
      expect(start.includedEventIds).toContain(sourceEventId);

      const followUpWithBoth = buildPromptRecallBrief(
        'Why did we pick Redis Cluster for rate limiting?',
        { db, projectRoot: projectDir, now },
        {
          alreadyInjectedDurableIds: start.includedDurableIds,
          alreadyInjectedEventIds: start.includedEventIds,
        },
      );
      expect(followUpWithBoth.injected).toBe(false);
      expect(followUpWithBoth.reason).toBe('already_injected');

      const followUpDurableOnly = buildPromptRecallBrief(
        'Why did we pick Redis Cluster for rate limiting?',
        { db, projectRoot: projectDir, now },
        {
          alreadyInjectedDurableIds: start.includedDurableIds,
        },
      );
      expect(followUpDurableOnly.injected).toBe(false);
      expect(followUpDurableOnly.reason).toBe('already_injected');
    });

    it('does not inject unmatched general conversation history when prompt terms do not overlap', () => {
      const scopedProject = normalizeProjectRootForScope(projectDir);
      const now = Date.parse('2026-06-20T12:00:00.000Z');

      db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-general-chat-1',
          'antigravity',
          'antigravity:conv:step:0',
          scopedProject,
          'conv-1',
          now - 2000,
          'user_prompt',
          JSON.stringify({
            prompt: 'Привет, как успехи, все еще ждем ответа по интерфейсу?',
            capture_policy: 'bounded_redacted',
          }),
          'medium',
          '[]',
          now - 2000,
        ],
      );
      db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'evt-general-chat-2',
          'antigravity',
          'antigravity:conv:step:1',
          scopedProject,
          'conv-1',
          now - 1000,
          'ai_response',
          JSON.stringify({
            response: 'Давай проведем живую проверку, интересно же, работает ли.',
            capture_policy: 'bounded_redacted',
          }),
          'medium',
          '[]',
          now - 1000,
        ],
      );

      const disjointBrief = buildPromptRecallBrief(
        'Однозначно сначала давай фиксить найденные баги в серверном SQLite пуле',
        { db, projectRoot: projectDir, now },
        { minConfidence: 'medium' },
      );

      expect(disjointBrief.injected).toBe(false);

      // Even when query-parser falls back to recent timeline (no extracted keywords, matchedTerms=[]),
      // unmatched general conversation and topicKey='general' entries must not be injected blindly.
      store.insert({
        topicKey: 'general',
        memoryType: 'decision',
        summary: 'Use SQLite for local workspace persistence.',
        evidence: { confidence: 0.95 },
        projectRoot: scopedProject,
        source: 'antigravity',
      });

      const genericPromptBrief = buildPromptRecallBrief(
        'what happened?',
        { db, projectRoot: projectDir, now },
        { minConfidence: 'medium' },
      );

      expect(genericPromptBrief.injected).toBe(false);
      expect(genericPromptBrief.reason).toBe('low_confidence');
    });
  });
});
