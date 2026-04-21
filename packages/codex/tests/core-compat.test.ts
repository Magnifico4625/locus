import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processInbox } from '../../core/src/ingest/pipeline.js';
import { runMigrations } from '../../core/src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../core/src/storage/node-sqlite.js';
import type { ConversationEventRow } from '../../core/src/types.js';
import { importCodexSessionsToInbox } from '../src/importer.js';

const require = createRequire(import.meta.url);
const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('Codex importer core ingest compatibility', () => {
  let tempDir: string;
  let sessionsDir: string;
  let inboxDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-codex-core-compat-'));
    sessionsDir = join(tempDir, 'sessions');
    inboxDir = join(tempDir, 'inbox');
    mkdirSync(sessionsDir, { recursive: true });

    cpSync(join(fixturesDir, 'basic-session.jsonl'), join(sessionsDir, 'rollout-basic.jsonl'));
    cpSync(join(fixturesDir, 'tool-session.jsonl'), join(sessionsDir, 'rollout-tool.jsonl'));
    cpSync(join(fixturesDir, 'decision-session.jsonl'), join(sessionsDir, 'rollout-decision.jsonl'));

    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (path: string) => unknown;
    };
    adapter = new NodeSqliteAdapter(new sqlite.DatabaseSync(join(tempDir, 'test.db')));
    runMigrations(adapter, false);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('imports Codex inbox files and stores them through core processInbox', () => {
    const firstImport = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
    });
    const secondImport = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'full',
    });

    expect(firstImport.written).toBeGreaterThan(0);
    expect(secondImport.duplicatePending).toBeGreaterThan(0);
    expect(readdirSync(inboxDir).filter((name) => name.endsWith('.json')).length).toBe(
      firstImport.written,
    );

    const firstIngest = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    expect(firstIngest.errors).toBe(0);
    expect(firstIngest.processed).toBeGreaterThan(0);

    const rows = adapter.all<ConversationEventRow>(
      'SELECT * FROM conversation_events ORDER BY timestamp, kind',
    );
    expect(rows).toHaveLength(firstIngest.processed);
    expect(rows.every((row) => row.source === 'codex')).toBe(true);

    const storedBeforeSecondIngest =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events')?.cnt ?? 0;
    const secondIngest = processInbox(inboxDir, adapter, { captureLevel: 'full' });
    const storedAfterSecondIngest =
      adapter.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM conversation_events')?.cnt ?? 0;

    expect(secondIngest.errors).toBe(0);
    expect(secondIngest.processed).toBe(0);
    expect(storedAfterSecondIngest).toBe(storedBeforeSecondIngest);
  });

  it('keeps bounded redacted payload metadata compatible with core ingest', () => {
    const importMetrics = importCodexSessionsToInbox({
      sessionsDir,
      inboxDir,
      captureMode: 'redacted',
    });

    expect(importMetrics.written).toBeGreaterThan(0);

    const redactedPromptFile = readdirSync(inboxDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(require('node:fs').readFileSync(join(inboxDir, name), 'utf-8')) as {
        kind: string;
        payload: Record<string, unknown>;
      })
      .find(
        (event) =>
          event.kind === 'user_prompt' &&
          event.payload.capture_policy === 'bounded_redacted',
      );

    expect(redactedPromptFile?.payload.capture_reason).toBeDefined();
    expect(typeof redactedPromptFile?.payload.truncated).toBe('boolean');

    const ingest = processInbox(inboxDir, adapter, { captureLevel: 'redacted' });
    expect(ingest.errors).toBe(0);
    expect(ingest.processed).toBeGreaterThan(0);

    const storedRows = adapter.all<ConversationEventRow>(
      "SELECT * FROM conversation_events WHERE source = 'codex' ORDER BY timestamp, kind",
    );
    expect(
      storedRows.some(
        (row) =>
          row.kind === 'user_prompt' &&
          row.payload_json?.includes('"capture_policy":"bounded_redacted"'),
      ),
    ).toBe(true);
    expect(
      storedRows.some(
        (row) => row.payload_json?.includes('"capture_policy":"bounded_redacted"'),
      ),
    ).toBe(true);
  });
});
