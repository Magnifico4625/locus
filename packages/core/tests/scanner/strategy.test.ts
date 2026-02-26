import { describe, expect, it } from 'vitest';
import { chooseScanStrategy, type ScanContext, type ScanDeps } from '../../src/scanner/index.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

// Helper: create a mock ScanDeps with defaults (no git, no files)
function mockDeps(overrides: Partial<ScanDeps> = {}): ScanDeps {
  return {
    isGitRepo: () => false,
    getHead: () => null,
    diffUnstaged: () => [],
    diffBetween: () => [],
    isAncestor: () => false,
    findByMtime: () => [],
    now: () => 1000,
    ...overrides,
  };
}

// Helper: create a default ScanContext
function ctx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    lastScan: 0,
    lastHead: null,
    lastFullRescan: 0,
    totalFiles: 100,
    ...overrides,
  };
}

const config = { ...LOCUS_DEFAULTS };

describe('chooseScanStrategy', () => {
  // ── Debounce ──────────────────────────────────────────────

  it('returns skip when last scan was too recent (debounce)', () => {
    const deps = mockDeps({ now: () => 1000 });
    // lastScan=995, minScanInterval=10 → elapsed=5 < 10 → skip
    const result = chooseScanStrategy('/project', ctx({ lastScan: 995 }), config, deps);
    expect(result.type).toBe('skip');
    expect(result.reason).toContain('debounce');
  });

  it('does not debounce when enough time has passed', () => {
    const deps = mockDeps({ now: () => 1000 });
    // lastScan=980, minScanInterval=10 → elapsed=20 > 10 → no debounce
    const result = chooseScanStrategy('/project', ctx({ lastScan: 980 }), config, deps);
    expect(result.type).not.toBe('skip');
  });

  // ── Git: same HEAD ────────────────────────────────────────

  it('returns skip when git HEAD unchanged and no unstaged changes', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'abc123',
      diffUnstaged: () => [],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123' }),
      config,
      deps,
    );
    expect(result.type).toBe('skip');
    expect(result.reason).toContain('no changes');
  });

  it('returns git-diff when HEAD unchanged but has unstaged changes', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'abc123',
      diffUnstaged: () => ['src/foo.ts', 'src/bar.ts'],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123' }),
      config,
      deps,
    );
    expect(result.type).toBe('git-diff');
    expect(result.filesToScan).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  // ── Git: fast-forward (ancestor) ──────────────────────────

  it('returns git-diff for fast-forward with few changed files', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      diffBetween: () => ['src/a.ts', 'src/b.ts'],
      isAncestor: () => true,
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('git-diff');
    expect(result.filesToScan).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns full when fast-forward has >30% files changed', () => {
    const changed = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      diffBetween: () => changed,
      isAncestor: () => true,
      now: () => 1000,
    });
    // 40 / 100 = 40% > 30% threshold → full
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('full');
    expect(result.reason).toContain('git');
  });

  it('returns full when fast-forward has >200 absolute changed files', () => {
    const changed = Array.from({ length: 201 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      diffBetween: () => changed,
      isAncestor: () => true,
      now: () => 1000,
    });
    // 201 > 200 absolute max → full
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 10000 }),
      config,
      deps,
    );
    expect(result.type).toBe('full');
  });

  // ── Git: branch switch (not ancestor) → mtime ────────────

  it('falls to mtime when HEAD changed but not ancestor (branch switch)', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      isAncestor: () => false,
      findByMtime: () => ['src/x.ts'],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('mtime');
    expect(result.filesToScan).toEqual(['src/x.ts']);
  });

  it('returns full from mtime when branch switch causes many changes', () => {
    const changed = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      isAncestor: () => false,
      findByMtime: () => changed,
      now: () => 1000,
    });
    // 50 / 100 = 50% > 30% → full
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('full');
    expect(result.reason).toContain('mtime');
  });

  // ── No git → mtime always ────────────────────────────────

  it('uses mtime when not a git repo', () => {
    const deps = mockDeps({
      isGitRepo: () => false,
      findByMtime: () => ['file1.ts', 'file2.py'],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('mtime');
    expect(result.filesToScan).toEqual(['file1.ts', 'file2.py']);
  });

  // ── Cooldown ──────────────────────────────────────────────

  it('prevents full rescan when cooldown is active', () => {
    const changed = Array.from({ length: 201 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => false,
      findByMtime: () => changed,
      now: () => 1000,
    });
    // lastFullRescan=800, now=1000, cooldown=300 → elapsed=200 < 300 → cooldown active
    // Even though 201 > 200, cooldown prevents full rescan → mtime
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastFullRescan: 800, totalFiles: 10000 }),
      config,
      deps,
    );
    expect(result.type).toBe('mtime');
    expect(result.filesToScan).toHaveLength(201);
  });

  it('allows full rescan when cooldown has expired', () => {
    const changed = Array.from({ length: 201 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => false,
      findByMtime: () => changed,
      now: () => 1200,
    });
    // lastFullRescan=800, now=1200, cooldown=300 → elapsed=400 > 300 → cooldown expired
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastFullRescan: 800, totalFiles: 10000 }),
      config,
      deps,
    );
    expect(result.type).toBe('full');
  });

  // ── Git error → fallback to mtime ─────────────────────────

  it('falls to mtime when git getHead throws', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => {
        throw new Error('git not found');
      },
      findByMtime: () => ['fallback.ts'],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('mtime');
    expect(result.filesToScan).toEqual(['fallback.ts']);
  });

  it('falls to mtime when git diffBetween throws', () => {
    const deps = mockDeps({
      isGitRepo: () => true,
      getHead: () => 'def456',
      isAncestor: () => true,
      diffBetween: () => {
        throw new Error('git diff failed');
      },
      findByMtime: () => ['fallback.ts'],
      now: () => 1000,
    });
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 900, lastHead: 'abc123', totalFiles: 100 }),
      config,
      deps,
    );
    expect(result.type).toBe('mtime');
    expect(result.filesToScan).toEqual(['fallback.ts']);
  });

  // ── First scan (lastScan=0, no git) → full ───────────────

  it('returns full on first scan (all files changed via mtime)', () => {
    const allFiles = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`);
    const deps = mockDeps({
      isGitRepo: () => false,
      findByMtime: () => allFiles,
      now: () => 1000,
    });
    // totalFiles=0 (empty DB), changed=50 → 50/0=Infinity > 0.3 → full
    const result = chooseScanStrategy(
      '/project',
      ctx({ lastScan: 0, totalFiles: 0 }),
      config,
      deps,
    );
    expect(result.type).toBe('full');
  });
});
