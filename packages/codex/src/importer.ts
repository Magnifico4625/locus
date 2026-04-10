import { readFileSync } from 'node:fs';
import { getCodexCaptureMode } from './capture.js';
import { toInboxEvent } from './inbox-event.js';
import { writeCodexInboxEvent } from './inbox-writer.js';
import { parseCodexJsonl } from './jsonl.js';
import { normalizeCodexRecords } from './normalize.js';
import { resolveCodexSessionsDir } from './paths.js';
import { findCodexRolloutFiles } from './session-files.js';
import type { CodexCaptureMode, CodexNormalizedEvent } from './types.js';

export interface CodexImportOptions {
  inboxDir: string;
  sessionsDir?: string;
  captureMode?: CodexCaptureMode;
  env?: Record<string, string | undefined>;
}

export interface CodexImportMetrics {
  filesScanned: number;
  recordsParsed: number;
  parseErrors: number;
  normalized: number;
  written: number;
  duplicatePending: number;
  skippedUnknown: number;
  skippedByCapture: number;
  errors: number;
  latestSession?: string;
}

export function importCodexSessionsToInbox(options: CodexImportOptions): CodexImportMetrics {
  const captureMode = options.captureMode ?? getCodexCaptureMode(options.env);
  const sessionsDir = resolveCodexSessionsDir({
    sessionsDir: options.sessionsDir,
    env: options.env,
  });
  const metrics = createEmptyMetrics();
  const files = findCodexRolloutFiles(sessionsDir);
  metrics.filesScanned = files.length;

  for (const filePath of files) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      metrics.errors++;
      continue;
    }

    const parsed = parseCodexJsonl(raw, filePath);
    metrics.recordsParsed += parsed.records.length;
    metrics.parseErrors += parsed.errors.length;

    const normalized = normalizeCodexRecords(parsed.records);
    metrics.normalized += normalized.events.length;
    metrics.skippedUnknown += normalized.skipped;
    updateLatestSession(metrics, normalized.events);

    for (const event of normalized.events) {
      const inboxEvent = toInboxEvent(event, captureMode);
      if (!inboxEvent) {
        metrics.skippedByCapture++;
        continue;
      }

      try {
        const writeResult = writeCodexInboxEvent(options.inboxDir, inboxEvent);
        if (writeResult.status === 'written') {
          metrics.written++;
        } else {
          metrics.duplicatePending++;
        }
      } catch {
        metrics.errors++;
      }
    }
  }

  return metrics;
}

function createEmptyMetrics(): CodexImportMetrics {
  return {
    filesScanned: 0,
    recordsParsed: 0,
    parseErrors: 0,
    normalized: 0,
    written: 0,
    duplicatePending: 0,
    skippedUnknown: 0,
    skippedByCapture: 0,
    errors: 0,
  };
}

function updateLatestSession(
  metrics: CodexImportMetrics,
  events: readonly CodexNormalizedEvent[],
): void {
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    if (event.timestamp >= latestTimestamp) {
      latestTimestamp = event.timestamp;
      metrics.latestSession = event.sessionId;
    }
  }
}
