import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboxEvent } from '../types.js';

/**
 * Atomically writes an InboxEvent as a JSON file to the project inbox directory.
 *
 * Write contract (from design doc Section 4.3):
 * 1. Atomic: write to .tmp → rename to final
 * 2. Naming: {timestamp}-{event_id_short}.json
 * 3. One file = one event
 * 4. UTF-8, no BOM
 *
 * @returns The filename (not full path) of the written event file.
 */
export function writeInboxEvent(inboxDir: string, event: InboxEvent): string {
  mkdirSync(inboxDir, { recursive: true });

  const shortId = event.event_id.slice(0, 8);
  const filename = `${event.timestamp}-${shortId}.json`;
  const finalPath = join(inboxDir, filename);
  const tmpPath = `${finalPath}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(event), 'utf-8');
  renameSync(tmpPath, finalPath);

  return filename;
}
