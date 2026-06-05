import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectHash } from '@locus/shared-runtime';
import { normalizeProjectRootForScope } from '../recall/project-scope.js';
import type { DatabaseAdapter, MemoryProjectStateResult } from '../types.js';

export interface ProjectGitState {
  gitHead?: string;
  gitBranch?: string;
  dirty?: boolean;
  timedOut?: boolean;
  unavailable?: boolean;
}

export interface ProjectStateDeps {
  db: DatabaseAdapter;
  projectRoot: string;
  readGitState?: (cwd: string) => ProjectGitState;
}

interface PackageMetadata {
  name?: string;
  version?: string;
}

interface CountRow {
  cnt: number;
}

interface LatestConversationRow {
  timestamp: number;
}

interface NextStepRow {
  summary: string;
}

const GIT_STATE_CACHE_MS = 5_000;

let gitStateCache:
  | {
      cwd: string;
      checkedAt: number;
      state: ProjectGitState;
    }
  | undefined;

export function resetProjectStateGitCacheForTests(): void {
  gitStateCache = undefined;
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 750,
  }).trim();
}

function readGitState(cwd: string): ProjectGitState {
  const now = Date.now();
  if (
    gitStateCache &&
    gitStateCache.cwd === cwd &&
    now - gitStateCache.checkedAt < GIT_STATE_CACHE_MS
  ) {
    return gitStateCache.state;
  }

  try {
    const state: ProjectGitState = {
      gitHead: gitOutput(cwd, ['rev-parse', '--short', 'HEAD']),
      gitBranch: gitOutput(cwd, ['branch', '--show-current']),
      dirty: gitOutput(cwd, ['status', '--porcelain', '--untracked-files=no']).length > 0,
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  } catch (error) {
    const state: ProjectGitState = {
      timedOut: error instanceof Error && /timeout/i.test(error.message),
      unavailable: true,
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  }
}

function readPackageMetadata(projectRoot: string): PackageMetadata {
  const packagePath = join(projectRoot, 'package.json');
  if (!existsSync(packagePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageMetadata;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    return {};
  }
}

export function handleProjectState(deps: ProjectStateDeps): MemoryProjectStateResult {
  const projectRoot = normalizeProjectRootForScope(deps.projectRoot);
  const packageMetadata = readPackageMetadata(deps.projectRoot);
  const activeDurableCount =
    deps.db.get<CountRow>(
      'SELECT COUNT(*) AS cnt FROM durable_memories WHERE state = ? AND project_root = ?',
      ['active', projectRoot],
    )?.cnt ?? 0;
  const latest = deps.db.get<LatestConversationRow>(
    `SELECT timestamp
     FROM conversation_events
     WHERE project_root = ?
     ORDER BY timestamp DESC, id DESC
     LIMIT 1`,
    [projectRoot],
  );
  const nextSteps = deps.db
    .all<NextStepRow>(
      `SELECT summary
       FROM durable_memories
       WHERE memory_type = ? AND state = ? AND project_root = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 5`,
      ['next_step', 'active', projectRoot],
    )
    .map((row) => row.summary);
  const git = (deps.readGitState ?? readGitState)(deps.projectRoot);
  const warnings = [
    ...(latest ? [] : ['No conversation events found for this project.']),
    ...(git.timedOut ? ['Git state lookup timed out; repo state may be incomplete.'] : []),
    ...(!git.timedOut && git.unavailable
      ? ['Git state lookup failed; repo state may be incomplete.']
      : []),
  ];

  return {
    projectRoot,
    projectHash: projectHash(projectRoot),
    packageName: packageMetadata.name,
    packageVersion: packageMetadata.version,
    gitHead: git.gitHead,
    gitBranch: git.gitBranch,
    dirty: git.dirty,
    activeDurableCount,
    latestConversationTimestamp: latest?.timestamp,
    latestConversationIso: latest ? new Date(latest.timestamp).toISOString() : undefined,
    warnings,
    nextSteps,
  };
}
