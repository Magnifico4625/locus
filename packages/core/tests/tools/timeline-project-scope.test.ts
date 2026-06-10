import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectRootForScope } from '../../src/recall/project-scope.js';
import { runMigrations } from '../../src/storage/migrations.js';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';
import { handleTimeline } from '../../src/tools/timeline.js';
import type { DatabaseAdapter } from '../../src/types.js';

function createAdapter(dir: string): NodeSqliteAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node:sqlite dynamic require
  const sqlite = require('node:sqlite') as any;
  return new NodeSqliteAdapter(new sqlite.DatabaseSync(join(dir, 'test.db')));
}

function insertEvent(
  db: DatabaseAdapter,
  opts: { eventId: string; projectRoot: string; summary: string },
): void {
  const timestamp = Date.parse('2026-05-30T10:00:00.000Z');
  db.run(
    `INSERT INTO conversation_events
     (event_id, source, source_event_id, project_root, session_id,
      timestamp, kind, payload_json, significance, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.eventId,
      'codex',
      null,
      normalizeProjectRootForScope(opts.projectRoot),
      `sess-${opts.eventId}`,
      timestamp,
      'session_end',
      JSON.stringify({ summary: opts.summary }),
      'high',
      null,
      timestamp,
    ],
  );
}

describe('memory_timeline project scope', () => {
  let dir: string;
  let db: NodeSqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-timeline-scope-'));
    db = createAdapter(dir);
    runMigrations(db, true);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists only the requested project', () => {
    insertEvent(db, {
      eventId: 'evt-locus',
      projectRoot: 'c:/repo/locus',
      summary: 'Locus Track D timeline event',
    });
    insertEvent(db, {
      eventId: 'evt-proxyvpn',
      projectRoot: 'c:/repo/proxyvpn',
      summary: 'ProxyVpn Track D timeline event',
    });

    const entries = handleTimeline({ db, projectRoot: 'C:/repo/locus' });

    expect(entries.map((entry) => entry.eventId)).toEqual(['evt-locus']);
    expect(JSON.stringify(entries)).not.toContain('ProxyVpn');
  });
});
