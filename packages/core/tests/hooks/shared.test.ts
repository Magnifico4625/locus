import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// ─── resolveProjectRoot — project marker resolution ──────────────────────────

describe('resolveProjectRoot — project markers', () => {
  const cleanupDirs: string[] = [];

  afterAll(() => {
    for (const dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it('returns git root when in a git repo (unchanged behavior)', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    const root = resolveProjectRoot(process.cwd());
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
    // Normalized: no trailing slash, forward slashes
    expect(root.endsWith('/')).toBe(false);
    expect(root.endsWith('\\')).toBe(false);
  });

  it('does not return the subdir itself when a marker exists in a parent', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    // Create: base/sub/deep/ with package.json at base/
    // Result should NOT be deep/ — it should be base/ or an ancestor with markers
    const base = join(tmpdir(), `locus-test-markers-notdeep-${Date.now()}`);
    const deep = join(base, 'sub', 'deep');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(base, 'package.json'), '{}', 'utf-8');
    cleanupDirs.push(base);

    const root = resolveProjectRoot(deep);
    const normalizedRoot = root.replace(/\\/g, '/');
    const normalizedDeep = resolve(deep).replace(/\\/g, '/');
    // Root should NOT be the deep subdir (markers exist above it)
    expect(normalizedRoot).not.toBe(normalizedDeep);
  });

  it('finds highest marker dir among nested markers', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    // Structure: outer/ (Cargo.toml) → outer/inner/ (Cargo.toml) → outer/inner/deep/
    // "Highest wins" = outer should beat inner
    const outer = join(tmpdir(), `locus-test-markers-nested-${Date.now()}`);
    const inner = join(outer, 'inner');
    const deep = join(inner, 'deep');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(outer, 'Cargo.toml'), '[package]\nname = "test"', 'utf-8');
    writeFileSync(join(inner, 'Cargo.toml'), '[package]\nname = "sub"', 'utf-8');
    cleanupDirs.push(outer);

    const root = resolveProjectRoot(deep);
    const normalizedRoot = root.replace(/\\/g, '/');
    const normalizedInner = resolve(inner).replace(/\\/g, '/');
    // Root must NOT be inner (outer or an ancestor with higher markers should win)
    expect(normalizedRoot).not.toBe(normalizedInner);
    const normalizedDeep = resolve(deep).replace(/\\/g, '/');
    expect(normalizedRoot).not.toBe(normalizedDeep);
  });

  it('result is a resolved absolute path with forward slashes', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    const base = join(tmpdir(), `locus-test-markers-abs-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'go.mod'), 'module test', 'utf-8');
    cleanupDirs.push(base);

    const root = resolveProjectRoot(base);
    // Forward slashes (normalized)
    expect(root).not.toContain('\\');
    // Absolute path
    expect(root.length).toBeGreaterThan(1);
  });

  it('returns a valid path for dir with no markers and no git', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    const bare = join(tmpdir(), `locus-test-markers-bare-${Date.now()}`);
    mkdirSync(bare, { recursive: true });
    cleanupDirs.push(bare);

    // Should not throw
    const root = resolveProjectRoot(bare);
    expect(typeof root).toBe('string');
    expect(root.length).toBeGreaterThan(0);
    // Note: on Windows, ~/package.json exists, so the result may be
    // an ancestor dir rather than cwd. This is correct "highest wins" behavior.
  });

  it('produces consistent results for the same cwd', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    const base = join(tmpdir(), `locus-test-markers-consistent-${Date.now()}`);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'pyproject.toml'), '[project]', 'utf-8');
    cleanupDirs.push(base);

    const root1 = resolveProjectRoot(base);
    const root2 = resolveProjectRoot(base);
    expect(root1).toBe(root2);
  });

  it('recognizes all 12 project markers without crashing', async () => {
    const { resolveProjectRoot } = await import('../../../claude-code/hooks/shared.js');
    const markers = [
      'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
      'pom.xml', 'build.gradle', 'build.gradle.kts', 'test.sln',
      'composer.json', 'Gemfile', 'deno.json', 'bun.lockb',
    ];
    for (const marker of markers) {
      const dir = join(tmpdir(), `locus-test-marker-${marker.replace(/[.*]/g, '_')}-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, marker), '', 'utf-8');
      cleanupDirs.push(dir);

      // Should not throw for any marker
      const root = resolveProjectRoot(dir);
      expect(typeof root).toBe('string');
    }
  });
});

// ─── computeProjectHash ──────────────────────────────────────────────────────

describe('computeProjectHash', () => {
  it('returns 16 hex chars', async () => {
    const { computeProjectHash } = await import('../../../claude-code/hooks/shared.js');
    const hash = computeProjectHash('/tmp/test-project');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('produces consistent hashes for the same path', async () => {
    const { computeProjectHash } = await import('../../../claude-code/hooks/shared.js');
    const hash1 = computeProjectHash('/tmp/my-project');
    const hash2 = computeProjectHash('/tmp/my-project');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different paths', async () => {
    const { computeProjectHash } = await import('../../../claude-code/hooks/shared.js');
    const hash1 = computeProjectHash('/tmp/project-a');
    const hash2 = computeProjectHash('/tmp/project-b');
    expect(hash1).not.toBe(hash2);
  });

  it('normalizes backslashes for cross-platform consistency', async () => {
    const { computeProjectHash } = await import('../../../claude-code/hooks/shared.js');
    const hashForward = computeProjectHash('C:/Users/test/project');
    const hashBackward = computeProjectHash('C:\\Users\\test\\project');
    expect(hashForward).toBe(hashBackward);
  });
});

// ─── computeSourceEventId ────────────────────────────────────────────────────

describe('computeSourceEventId', () => {
  it('returns 16 hex chars', async () => {
    const { computeSourceEventId } = await import('../../../claude-code/hooks/shared.js');
    const id = computeSourceEventId('session-1', '1708876543210', 'hello');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic — same inputs produce same output', async () => {
    const { computeSourceEventId } = await import('../../../claude-code/hooks/shared.js');
    const id1 = computeSourceEventId('session-1', '1708876543210', 'hello world');
    const id2 = computeSourceEventId('session-1', '1708876543210', 'hello world');
    expect(id1).toBe(id2);
  });

  it('different inputs produce different outputs', async () => {
    const { computeSourceEventId } = await import('../../../claude-code/hooks/shared.js');
    const id1 = computeSourceEventId('session-1', '1708876543210', 'prompt A');
    const id2 = computeSourceEventId('session-1', '1708876543210', 'prompt B');
    expect(id1).not.toBe(id2);
  });

  it('different sessions produce different outputs', async () => {
    const { computeSourceEventId } = await import('../../../claude-code/hooks/shared.js');
    const id1 = computeSourceEventId('session-1', '1708876543210', 'same prompt');
    const id2 = computeSourceEventId('session-2', '1708876543210', 'same prompt');
    expect(id1).not.toBe(id2);
  });

  it('handles empty parts gracefully', async () => {
    const { computeSourceEventId } = await import('../../../claude-code/hooks/shared.js');
    const id = computeSourceEventId('', '', '');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });
});
