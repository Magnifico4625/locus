import { basename } from 'node:path';
import { runRecallEngine } from '../recall/engine.js';
import { buildProjectScopeClause, normalizeProjectRootForScope } from '../recall/project-scope.js';
import { handleProjectState, type ProjectGitState } from '../tools/project-state.js';
import type {
  AutoContextBrief,
  AutoContextMode,
  AutoContextReason,
  DatabaseAdapter,
  MemoryRecallCandidate,
  MemoryRecallConfidence,
} from '../types.js';
import { estimateTokens } from '../utils.js';

export interface SessionStartBriefDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  now?: number;
  readGitState?: (cwd: string) => ProjectGitState;
}

export interface SessionStartBriefOptions {
  maxTokens?: number;
  maxDecisions?: number;
  maxConstraints?: number;
  maxNextSteps?: number;
  maxRecentFiles?: number;
}

export interface PromptRecallBriefDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  now?: number;
}

export interface PromptRecallBriefOptions {
  maxTokens?: number;
  maxItems?: number;
  minConfidence?: 'high' | 'medium';
  alreadyInjectedDurableIds?: Iterable<number>;
  alreadyInjectedEventIds?: Iterable<string>;
}

interface DurableSummaryRow {
  id: number;
  summary: string;
  source_event_id: string | null;
}

interface SemanticSummaryRow {
  content: string;
}

interface FilePathRow {
  file_path: string;
}

const MAX_BULLET_CHARS = 140;

const NOISY_PHRASES = new Set([
  'ok',
  'okay',
  'yes',
  'no',
  'yep',
  'yup',
  'nope',
  'sure',
  'continue',
  'go',
  'go ahead',
  'proceed',
  'thanks',
  'thank you',
  'thx',
  'done',
  'lgtm',
  'sounds good',
  'got it',
  'agreed',
  'да',
  'нет',
  'ок',
  'окей',
  'хорошо',
  'ладно',
  'понял',
  'понятно',
  'продолжай',
  'дальше',
  'делай',
  'поехали',
  'спасибо',
  'готово',
  'норм',
  'ага',
  'угу',
  'супер',
  'отлично',
]);

const SINGLE_ACK_WORDS = new Set([
  'ok',
  'okay',
  'yes',
  'no',
  'yep',
  'yup',
  'nope',
  'sure',
  'continue',
  'go',
  'proceed',
  'thanks',
  'thx',
  'done',
  'lgtm',
  'agreed',
  'да',
  'нет',
  'ок',
  'окей',
  'хорошо',
  'ладно',
  'понял',
  'понятно',
  'продолжай',
  'дальше',
  'делай',
  'поехали',
  'спасибо',
  'готово',
  'норм',
  'ага',
  'угу',
  'супер',
  'отлично',
]);

function emptyBrief(mode: AutoContextMode, reason: AutoContextReason): AutoContextBrief {
  return {
    mode,
    injected: false,
    reason,
    text: '',
    estimatedTokens: 0,
    includedDurableIds: [],
    includedEventIds: [],
  };
}

function truncateLine(text: string, maxChars = MAX_BULLET_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3)}...`;
}

function isNumberedAcknowledgement(text: string): boolean {
  const withoutNumbers = text
    .toLowerCase()
    .replace(/\b\d+[.)]\s*/gu, ' ')
    .replace(/[.!?…,;:]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutNumbers) {
    return false;
  }

  const tokens = withoutNumbers.split(' ');
  return tokens.length <= 6 && tokens.every((token) => SINGLE_ACK_WORDS.has(token));
}

export function isNoisyPrompt(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  if (/^\/[a-z0-9_:-]+$/iu.test(normalized)) {
    return true;
  }

  const stripped = normalized
    .toLowerCase()
    .replace(/[.!?…,;:]+$/gu, '')
    .trim();
  if (!stripped) {
    return true;
  }

  if (NOISY_PHRASES.has(stripped)) {
    return true;
  }

  if (/^\d+[.)]\s*/u.test(normalized) && isNumberedAcknowledgement(normalized)) {
    return true;
  }

  if (normalized.length < 8 && !/[./?]/u.test(normalized)) {
    return true;
  }

  return false;
}

function appendLineWithinBudget(lines: string[], line: string, maxTokens: number): boolean {
  const candidate = lines.length === 0 ? line : `${lines.join('\n')}\n${line}`;
  if (estimateTokens(candidate) > maxTokens) {
    return false;
  }
  lines.push(line);
  return true;
}

function appendSectionItems<T>(
  lines: string[],
  header: string,
  items: readonly T[],
  maxTokens: number,
  getText: (item: T) => string,
  onIncluded?: (item: T) => void,
): void {
  const firstItem = items[0];
  if (!firstItem) {
    return;
  }

  const firstBullet = `- ${truncateLine(getText(firstItem))}`;
  const preview = `${lines.join('\n')}\n${header}\n${firstBullet}`;
  if (estimateTokens(preview) > maxTokens) {
    return;
  }

  lines.push(header, firstBullet);
  onIncluded?.(firstItem);

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (!appendLineWithinBudget(lines, `- ${truncateLine(getText(item))}`, maxTokens)) {
      break;
    }
    onIncluded?.(item);
  }
}

export function buildSessionStartBrief(
  deps: SessionStartBriefDeps,
  options?: SessionStartBriefOptions,
): AutoContextBrief {
  const maxTokens = Math.max(40, options?.maxTokens ?? 500);
  const maxDecisions = Math.max(1, options?.maxDecisions ?? 5);
  const maxConstraints = Math.max(1, options?.maxConstraints ?? 3);
  const maxNextSteps = Math.max(1, options?.maxNextSteps ?? 3);
  const maxRecentFiles = Math.max(1, options?.maxRecentFiles ?? 5);

  const scopedRoot = normalizeProjectRootForScope(deps.projectRoot);
  const scope = buildProjectScopeClause('project_root', scopedRoot);
  const state = handleProjectState({
    db: deps.db,
    projectRoot: deps.projectRoot,
    readGitState: deps.readGitState,
  });

  const decisions = deps.db.all<DurableSummaryRow>(
    `SELECT id, summary, source_event_id
     FROM durable_memories
     WHERE memory_type = 'decision' AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxDecisions],
  );

  const semanticFallback =
    decisions.length === 0
      ? deps.db.all<SemanticSummaryRow>(
          `SELECT content
           FROM memories
           WHERE layer = 'semantic' AND ${scope.clause}
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`,
          [...scope.params, maxDecisions],
        )
      : [];

  const constraintsAndPrefs = deps.db.all<DurableSummaryRow>(
    `SELECT id, summary, source_event_id
     FROM durable_memories
     WHERE memory_type IN ('constraint', 'preference', 'style') AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxConstraints],
  );

  const nextSteps = deps.db.all<DurableSummaryRow>(
    `SELECT id, summary, source_event_id
     FROM durable_memories
     WHERE memory_type = 'next_step' AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxNextSteps],
  );

  const eventScope = buildProjectScopeClause('ce.project_root', scopedRoot);
  const recentFiles = deps.db
    .all<FilePathRow>(
      `SELECT ef.file_path
       FROM event_files ef
       JOIN conversation_events ce ON ce.event_id = ef.event_id
       WHERE ${eventScope.clause}
       GROUP BY ef.file_path
       ORDER BY MAX(ce.timestamp) DESC
       LIMIT ?`,
      [...eventScope.params, maxRecentFiles],
    )
    .map((row) => row.file_path);

  const hasContent =
    decisions.length > 0 ||
    semanticFallback.length > 0 ||
    constraintsAndPrefs.length > 0 ||
    nextSteps.length > 0 ||
    state.latestConversationTimestamp !== undefined;

  if (!hasContent) {
    return emptyBrief('session_start', 'empty_memory');
  }

  const lines: string[] = [];
  if (!appendLineWithinBudget(lines, '[Locus Memory — Project Brief]', maxTokens)) {
    return emptyBrief('session_start', 'empty_memory');
  }

  const projectParts = [state.packageName || basename(scopedRoot) || scopedRoot];
  if (state.packageVersion) {
    projectParts.push(`v${state.packageVersion}`);
  }
  if (state.gitBranch) {
    projectParts.push(`branch=${state.gitBranch}`);
  }
  if (state.dirty) {
    projectParts.push('dirty');
  }
  appendLineWithinBudget(lines, `Project: ${projectParts.join(' | ')}`, maxTokens);

  const includedDurableIds: number[] = [];
  const includedEventIds = new Set<string>();
  const recordDurable = (item: DurableSummaryRow) => {
    includedDurableIds.push(item.id);
    if (item.source_event_id) {
      includedEventIds.add(item.source_event_id);
    }
  };

  if (decisions.length > 0) {
    appendSectionItems(
      lines,
      'Decisions:',
      decisions,
      maxTokens,
      (item) => item.summary,
      recordDurable,
    );
  } else if (semanticFallback.length > 0) {
    appendSectionItems(lines, 'Decisions:', semanticFallback, maxTokens, (item) => item.content);
  }

  if (constraintsAndPrefs.length > 0) {
    appendSectionItems(
      lines,
      'Constraints & Preferences:',
      constraintsAndPrefs,
      maxTokens,
      (item) => item.summary,
      recordDurable,
    );
  }

  if (nextSteps.length > 0) {
    appendSectionItems(
      lines,
      'Next Steps:',
      nextSteps,
      maxTokens,
      (item) => item.summary,
      recordDurable,
    );
  }

  if (recentFiles.length > 0) {
    appendLineWithinBudget(lines, `Recent Files: ${recentFiles.join(', ')}`, maxTokens);
  }

  const text = lines.join('\n');
  return {
    mode: 'session_start',
    injected: true,
    reason: 'ok',
    text,
    estimatedTokens: estimateTokens(text),
    includedDurableIds,
    includedEventIds: [...includedEventIds],
  };
}

function meetsConfidence(
  confidence: MemoryRecallConfidence | undefined,
  minConfidence: 'high' | 'medium',
): boolean {
  if (minConfidence === 'high') {
    return confidence === 'high';
  }
  return confidence === 'high' || confidence === 'medium';
}

function isRelevantCandidate(candidate: MemoryRecallCandidate, hasResolvedRange: boolean): boolean {
  if ((candidate.matchedTerms?.length ?? 0) > 0 || hasResolvedRange) {
    return true;
  }

  const hasSpecificTopic =
    typeof candidate.topicKey === 'string' &&
    candidate.topicKey.length > 0 &&
    candidate.topicKey !== 'general';

  return hasSpecificTopic && candidate.sourceKind === 'durable' && candidate.confidence === 'high';
}

function loadDurableSourceEventIds(db: DatabaseAdapter, durableIds: Iterable<number>): string[] {
  const ids = [...new Set(durableIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.all<{ source_event_id: string | null }>(
    `SELECT source_event_id FROM durable_memories WHERE id IN (${placeholders}) AND source_event_id IS NOT NULL`,
    ids,
  );
  return rows
    .map((row) => row.source_event_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function isAlreadyInjected(
  candidate: MemoryRecallCandidate,
  seenDurable: ReadonlySet<number>,
  seenEvents: ReadonlySet<string>,
): boolean {
  if (candidate.durableMemoryIds.length > 0) {
    return candidate.durableMemoryIds.every((id) => seenDurable.has(id));
  }
  if (candidate.eventIds.length > 0) {
    return candidate.eventIds.every((id) => seenEvents.has(id));
  }
  return false;
}

export function buildPromptRecallBrief(
  prompt: string,
  deps: PromptRecallBriefDeps,
  options?: PromptRecallBriefOptions,
): AutoContextBrief {
  if (isNoisyPrompt(prompt)) {
    return emptyBrief('prompt_recall', 'noise_filtered');
  }

  const maxTokens = Math.max(40, options?.maxTokens ?? 300);
  const maxItems = Math.max(1, options?.maxItems ?? 3);
  const minConfidence = options?.minConfidence ?? 'medium';
  const now = deps.now ?? Date.now();

  const recall = runRecallEngine(
    prompt,
    { db: deps.db, projectRoot: deps.projectRoot, now },
    { limit: 8, now },
  );

  if (recall.status === 'no_memory' || recall.candidates.length === 0) {
    return emptyBrief('prompt_recall', 'empty_memory');
  }

  const hasResolvedRange = Boolean(recall.resolvedRange);
  const confidentAndRelevant = recall.candidates.filter(
    (candidate) =>
      meetsConfidence(candidate.confidence, minConfidence) &&
      isRelevantCandidate(candidate, hasResolvedRange),
  );

  if (confidentAndRelevant.length === 0) {
    return emptyBrief('prompt_recall', 'low_confidence');
  }

  const seenDurable = new Set<number>(options?.alreadyInjectedDurableIds ?? []);
  const seenEvents = new Set<string>(options?.alreadyInjectedEventIds ?? []);
  for (const eventId of loadDurableSourceEventIds(deps.db, seenDurable)) {
    seenEvents.add(eventId);
  }
  const freshCandidates = confidentAndRelevant.filter(
    (candidate) => !isAlreadyInjected(candidate, seenDurable, seenEvents),
  );

  if (freshCandidates.length === 0) {
    return emptyBrief('prompt_recall', 'already_injected');
  }

  const lines: string[] = ['[Locus Memory — Relevant Recall]'];
  const includedDurableIds = new Set<number>();
  const includedEventIds = new Set<string>();
  let added = 0;

  for (const candidate of freshCandidates) {
    if (added >= maxItems) {
      break;
    }

    const label = candidate.topicKey ?? candidate.intent ?? candidate.sourceKind ?? 'memory';
    const bullet = `- [${label}] ${truncateLine(candidate.headline)}`;
    if (!appendLineWithinBudget(lines, bullet, maxTokens)) {
      break;
    }

    added++;
    for (const id of candidate.durableMemoryIds) {
      includedDurableIds.add(id);
    }
    for (const id of candidate.eventIds) {
      includedEventIds.add(id);
    }
  }

  if (added === 0) {
    return emptyBrief('prompt_recall', 'empty_memory');
  }

  for (const eventId of loadDurableSourceEventIds(deps.db, includedDurableIds)) {
    includedEventIds.add(eventId);
  }

  const text = lines.join('\n');
  return {
    mode: 'prompt_recall',
    injected: true,
    reason: 'ok',
    text,
    estimatedTokens: estimateTokens(text),
    includedDurableIds: [...includedDurableIds],
    includedEventIds: [...includedEventIds],
  };
}
