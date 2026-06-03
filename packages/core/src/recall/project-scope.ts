import { normalizePathForIdentity } from '@locus/shared-runtime';

export interface ProjectScopeClauseOptions {
  includeLegacyGlobal?: boolean;
}

export interface ProjectScopeClause {
  clause: string;
  params: string[];
}

export function normalizeProjectRootForScope(projectRoot: string): string {
  const normalized = normalizePathForIdentity(projectRoot.trim());
  if (normalized === '/' || /^[a-z]:\/$/u.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/$/u, '');
}

export function isSameProjectRoot(left: string | null | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  return normalizeProjectRootForScope(left) === normalizeProjectRootForScope(right);
}

export function buildProjectScopeClause(
  column: string,
  projectRoot: string,
  options?: ProjectScopeClauseOptions,
): ProjectScopeClause {
  const normalized = normalizeProjectRootForScope(projectRoot);
  if (options?.includeLegacyGlobal) {
    return {
      clause: `(${column} = ? OR ${column} IS NULL)`,
      params: [normalized],
    };
  }

  return {
    clause: `${column} = ?`,
    params: [normalized],
  };
}
