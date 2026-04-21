import { readFileSync } from 'node:fs';
import { getCodexCaptureMode } from './capture.js';
import { toInboxEvent } from './inbox-event.js';
import { writeCodexInboxEvent } from './inbox-writer.js';
import { parseCodexJsonl } from './jsonl.js';
import { normalizeCodexRecords } from './normalize.js';
import { resolveCodexSessionsDir } from './paths.js';
import { findCodexRolloutFiles } from './session-files.js';
import type { CodexImportMetrics, CodexImportOptions, CodexNormalizedEvent } from './types.js';

export function importCodexSessionsToInbox(options: CodexImportOptions): CodexImportMetrics {
  const captureMode = options.captureMode ?? getCodexCaptureMode(options.env);
  const sessionsDir = resolveCodexSessionsDir({
    sessionsDir: options.sessionsDir,
    env: options.env,
  });
  const metrics = createEmptyMetrics();
  const files = selectFiles(findCodexRolloutFiles(sessionsDir), options);
  metrics.filesScanned = files.length;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

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
    metrics.skippedUnknown += normalized.skipped;
    const filteredEvents = normalized.events.filter((event) => matchesFilters(event, options));
    metrics.normalized += filteredEvents.length;
    metrics.skippedByFilter += normalized.events.length - filteredEvents.length;
    latestTimestamp = updateLatestSession(metrics, filteredEvents, latestTimestamp);

    for (const event of filteredEvents) {
      importFilteredEvent(event, captureMode, options, metrics);
    }
  }

  return metrics;
}

function importFilteredEvent(
  event: CodexNormalizedEvent,
  captureMode: ReturnType<typeof getCodexCaptureMode>,
  options: CodexImportOptions,
  metrics: CodexImportMetrics,
): void {
  const inboxEvent = toInboxEvent(event, captureMode);
  if (!inboxEvent) {
    metrics.skippedByCapture++;
    return;
  }

  if (options.shouldSkipEventId?.(inboxEvent.event_id) === true) {
    metrics.duplicatePending++;
    return;
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
    skippedByFilter: 0,
    errors: 0,
    latestSession: undefined,
  };
}

function updateLatestSession(
  metrics: CodexImportMetrics,
  events: readonly CodexNormalizedEvent[],
  latestTimestamp: number,
): number {
  let nextLatestTimestamp = latestTimestamp;
  for (const event of events) {
    if (event.timestamp >= nextLatestTimestamp) {
      nextLatestTimestamp = event.timestamp;
      metrics.latestSession = event.sessionId;
    }
  }

  return nextLatestTimestamp;
}

function selectFiles(files: readonly string[], options: CodexImportOptions): string[] {
  if (options.latestOnly) {
    const latestFile = files.at(-1);
    return latestFile === undefined ? [] : [latestFile];
  }

  return [...files];
}

function matchesFilters(event: CodexNormalizedEvent, options: CodexImportOptions): boolean {
  if (options.projectRoot !== undefined && event.projectRoot !== options.projectRoot) {
    return false;
  }

  if (options.sessionId !== undefined && event.sessionId !== options.sessionId) {
    return false;
  }

  if (options.since !== undefined && event.timestamp < options.since) {
    return false;
  }

  return true;
}
