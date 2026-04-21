import * as sharedRuntime from '@locus/shared-runtime';
import { describe, expect, it } from 'vitest';

type NormalizePathForIdentity = (pathValue: string) => string;

function getNormalizePathForIdentity(): NormalizePathForIdentity | undefined {
  return (sharedRuntime as { normalizePathForIdentity?: NormalizePathForIdentity })
    .normalizePathForIdentity;
}

describe('normalizePathForIdentity (shared-runtime)', () => {
  it('is exported from the shared runtime barrel', () => {
    const normalizePathForIdentity = getNormalizePathForIdentity();

    expect(typeof normalizePathForIdentity).toBe('function');
  });

  it('normalizes Windows backslashes to forward slashes', () => {
    const normalizePathForIdentity = getNormalizePathForIdentity();

    expect(typeof normalizePathForIdentity).toBe('function');
    if (!normalizePathForIdentity) return;

    expect(normalizePathForIdentity('C:\\Users\\Admin\\my-project')).toBe(
      'c:/users/admin/my-project',
    );
  });

  it('normalizes duplicate separators into one stable identity path', () => {
    const normalizePathForIdentity = getNormalizePathForIdentity();

    expect(typeof normalizePathForIdentity).toBe('function');
    if (!normalizePathForIdentity) return;

    expect(normalizePathForIdentity('C:\\Users\\\\Admin\\projects///locus')).toBe(
      'c:/users/admin/projects/locus',
    );
  });

  it('treats forward-slash and backslash variants as the same identity path', () => {
    const normalizePathForIdentity = getNormalizePathForIdentity();

    expect(typeof normalizePathForIdentity).toBe('function');
    if (!normalizePathForIdentity) return;

    expect(normalizePathForIdentity('C:/Users/Admin/my-project')).toBe(
      normalizePathForIdentity('c:\\Users\\Admin\\my-project'),
    );
  });
});
