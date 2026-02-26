import { describe, expect, it } from 'vitest';

describe('Project scaffold', () => {
  it('types module exports LOCUS_DEFAULTS', async () => {
    const { LOCUS_DEFAULTS } = await import('../src/types.js');
    expect(LOCUS_DEFAULTS).toBeDefined();
    expect(LOCUS_DEFAULTS.captureLevel).toBe('metadata');
    expect(LOCUS_DEFAULTS.rescanThreshold).toBe(0.3);
    expect(LOCUS_DEFAULTS.rescanAbsoluteMax).toBe(200);
  });

  it('utils exports projectHash', async () => {
    const { projectHash } = await import('../src/utils.js');
    expect(projectHash).toBeTypeOf('function');
    const hash = projectHash('/home/user/project');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('projectHash is deterministic', async () => {
    const { projectHash } = await import('../src/utils.js');
    expect(projectHash('/home/user/project')).toBe(projectHash('/home/user/project'));
  });

  it('projectHash normalizes Windows paths', async () => {
    const { projectHash } = await import('../src/utils.js');
    expect(projectHash('C:\\Users\\Admin\\project')).toBe(projectHash('C:/Users/Admin/project'));
  });
});
