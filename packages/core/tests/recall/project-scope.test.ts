import { describe, expect, it } from 'vitest';
import {
  buildProjectScopeClause,
  isSameProjectRoot,
  normalizeProjectRootForScope,
} from '../../src/recall/project-scope.js';

describe('project scope helpers', () => {
  it('normalizes Windows and POSIX paths for stable scope identity', () => {
    expect(normalizeProjectRootForScope('C:\\Users\\Admin\\Project')).toBe(
      'c:/users/admin/project',
    );
    expect(normalizeProjectRootForScope('C:/Users/Admin//Project/')).toBe(
      'c:/users/admin/project',
    );
  });

  it('matches equivalent project roots', () => {
    expect(isSameProjectRoot('C:\\Users\\Admin\\Project', 'c:/users/admin/project')).toBe(true);
    expect(isSameProjectRoot('/repo/locus', '/repo/other')).toBe(false);
  });

  it('builds strict SQL scope by default', () => {
    expect(buildProjectScopeClause('project_root', 'C:/repo/locus')).toEqual({
      clause: 'project_root = ?',
      params: ['c:/repo/locus'],
    });
  });

  it('can include legacy global rows only when explicitly allowed', () => {
    expect(
      buildProjectScopeClause('project_root', 'C:/repo/locus', { includeLegacyGlobal: true }),
    ).toEqual({
      clause: '(project_root = ? OR project_root IS NULL)',
      params: ['c:/repo/locus'],
    });
  });
});
