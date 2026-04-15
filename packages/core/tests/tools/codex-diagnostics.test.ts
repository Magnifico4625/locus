import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { collectCodexDiagnostics } from '../../src/tools/codex-diagnostics.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  const raw = new sqlite.DatabaseSync(join(dir, 'test.db'));
  return new NodeSqliteAdapter(raw);
}

describe('collectCodexDiagnostics', () => {
  let tempDir: string;
  let adapter: NodeSqliteAdapter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-codex-diagnostics-'));
    adapter = createAdapter(tempDir);
    runMigrations(adapter, true);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns undefined when CODEX_HOME is absent', () => {
    expect(
      collectCodexDiagnostics({
        db: adapter,
        env: {},
      }),
    ).toBeUndefined();
  });

  it('returns resolved sessions metadata and latest rollout details from CODEX_HOME', () => {
    const codexHome = join(tempDir, 'codex-home');
    const sessionsDir = join(codexHome, 'sessions', '2026', '04');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'rollout-2026-04-13T09-00-00.jsonl'), '{}\n', 'utf8');
    writeFileSync(join(sessionsDir, 'rollout-2026-04-14T12-00-00.jsonl'), '{}\n', 'utf8');

    const diagnostics = collectCodexDiagnostics({
      db: adapter,
      env: {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'metadata',
      },
    });

    expect(diagnostics).toMatchObject({
      captureMode: 'metadata',
      sessionsDir: join(codexHome, 'sessions'),
      sessionsDirExists: true,
      rolloutFilesFound: 2,
      latestRolloutPath: join(sessionsDir, 'rollout-2026-04-14T12-00-00.jsonl'),
      latestRolloutReadable: true,
      importedEventCount: 0,
    });
  });

  it('uses persisted Codex rows to report imported event count and latest imported session', () => {
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(join(codexHome, 'sessions'), { recursive: true });
    const now = Date.now();

    adapter.run(
      'INSERT INTO ingest_log (event_id, source, source_event_id, processed_at) VALUES (?, ?, ?, ?)',
      ['codex-1', 'codex', 'source-1', now - 1000],
    );
    adapter.run(
      'INSERT INTO ingest_log (event_id, source, source_event_id, processed_at) VALUES (?, ?, ?, ?)',
      ['codex-2', 'codex', 'source-2', now],
    );
    adapter.run(
      `INSERT INTO conversation_events
       (event_id, source, source_event_id, project_root, session_id, timestamp, kind, payload_json, significance, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'codex-2',
        'codex',
        'source-2',
        '/project',
        'session-xyz',
        now,
        'session_end',
        '{}',
        'medium',
        null,
        now,
      ],
    );

    const diagnostics = collectCodexDiagnostics({
      db: adapter,
      env: {
        CODEX_HOME: codexHome,
        LOCUS_CODEX_CAPTURE: 'full',
      },
    });

    expect(diagnostics).toMatchObject({
      captureMode: 'full',
      importedEventCount: 2,
      latestImportedSessionId: 'session-xyz',
      latestImportedTimestamp: now,
    });
  });
});
