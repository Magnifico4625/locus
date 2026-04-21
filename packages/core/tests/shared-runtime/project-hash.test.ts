import { projectHash } from '@locus/shared-runtime';
import { describe, expect, it } from 'vitest';

describe('projectHash (shared-runtime)', () => {
  it('returns 16 hex chars', () => {
    expect(projectHash('/tmp/test-project')).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    expect(projectHash('/tmp/my-project')).toBe(projectHash('/tmp/my-project'));
  });

  it('differs for different paths', () => {
    expect(projectHash('/tmp/project-a')).not.toBe(projectHash('/tmp/project-b'));
  });

  it('normalizes backslashes (cross-platform)', () => {
    expect(projectHash('C:/Users/test/project')).toBe(projectHash('C:\\Users\\test\\project'));
  });

  it('normalizes case (Windows paths)', () => {
    expect(projectHash('C:/Users/Test/Project')).toBe(projectHash('c:/users/test/project'));
  });

  it('normalizes duplicate separators before hashing', () => {
    expect(projectHash('C:/Users//Test///Project')).toBe(projectHash('c:\\users\\test\\project'));
  });
});
