import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocusInboxEventV1 } from './inbox-event.js';

export type CodexInboxWriteResult =
  | { status: 'written'; filename: string }
  | { status: 'duplicate_pending'; filename: string };

export function writeCodexInboxEvent(
  inboxDir: string,
  event: LocusInboxEventV1,
): CodexInboxWriteResult {
  mkdirSync(inboxDir, { recursive: true });

  const filename = `${event.timestamp}-${event.event_id.slice(0, 8)}.json`;
  const finalPath = join(inboxDir, filename);

  if (existsSync(finalPath)) {
    return { status: 'duplicate_pending', filename };
  }

  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(event), 'utf-8');
  renameSync(tmpPath, finalPath);

  return { status: 'written', filename };
}
