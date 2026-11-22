import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';
import { resolvePackageVersion } from '../src/package-info.js';
import { installLocalCliRuntime } from '../src/runtime-install.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'locus-runtime-install-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('installLocalCliRuntime', () => {
  it('installs, skips unchanged copies, and updates when bundle bytes change', () => {
    const root = makeTempDir();
    const distDir = join(root, 'dist');
    const locusHome = join(root, 'locus-home');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'cli.js'), 'console.log("cli v1");\n', 'utf8');
    writeFileSync(join(distDir, 'server.js'), 'console.log("server v1");\n', 'utf8');

    const first = installLocalCliRuntime({
      env: { LOCUS_HOME: locusHome },
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
      now: new Date('2026-06-20T10:00:00.000Z'),
    });

    expect(first.action).toBe('installed');
    expect(first.version).toBe('3.7.0');
    expect(existsSync(first.cliPath)).toBe(true);
    expect(existsSync(first.serverPath)).toBe(true);
    expect(existsSync(first.manifestPath)).toBe(true);
    expect(existsSync(join(first.binDir, 'package.json'))).toBe(true);
    expect(readdirSync(first.binDir).some((file) => file.endsWith('.locus-tmp'))).toBe(false);

    const manifest = JSON.parse(readFileSync(first.manifestPath, 'utf8')) as {
      version: string;
      installedAt: string;
      cliPath: string;
      serverPath: string;
    };
    expect(manifest).toEqual({
      version: '3.7.0',
      installedAt: '2026-06-20T10:00:00.000Z',
      cliPath: first.cliPath,
      serverPath: first.serverPath,
    });
    expect(resolvePackageVersion(first.binDir)).toBe('3.7.0');

    const second = installLocalCliRuntime({
      env: { LOCUS_HOME: locusHome },
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
      now: new Date('2026-06-20T11:00:00.000Z'),
    });
    expect(second.action).toBe('unchanged');

    writeFileSync(join(distDir, 'cli.js'), 'console.log("cli v2");\n', 'utf8');
    const third = installLocalCliRuntime({
      env: { LOCUS_HOME: locusHome },
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
      now: new Date('2026-06-20T12:00:00.000Z'),
    });
    expect(third.action).toBe('updated');
    expect(readFileSync(third.cliPath, 'utf8')).toContain('cli v2');
    expect(readdirSync(third.binDir).some((file) => file.endsWith('.locus-tmp'))).toBe(false);
  });

  it('returns clear error when source dist artifacts are missing', async () => {
    const root = makeTempDir();
    const emptyDist = join(root, 'empty-dist');
    const locusHome = join(root, 'locus-home');
    mkdirSync(emptyDist, { recursive: true });

    expect(() =>
      installLocalCliRuntime({
        env: { LOCUS_HOME: locusHome },
        sourceDistDir: emptyDist,
        startDir: import.meta.dirname,
      }),
    ).toThrow('Missing built runtime artifacts');

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ['sync-runtime'],
      {
        stdout: (msg) => stdout.push(msg),
        stderr: (msg) => stderr.push(msg),
      },
      {
        env: { LOCUS_HOME: locusHome },
        sourceDistDir: emptyDist,
        startDir: import.meta.dirname,
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Missing built runtime artifacts');
  });
});
