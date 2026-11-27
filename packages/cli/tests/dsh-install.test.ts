import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'locus-dsh-install-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeDist(): string {
  const distDir = join(makeTempDir('locus-dsh-dist-'), 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'cli.js'), 'console.log("cli mock v1");\n', 'utf8');
  writeFileSync(join(distDir, 'server.js'), 'console.log("server mock v1");\n', 'utf8');
  writeFileSync(
    join(distDir, 'dsh-plugin.js'),
    'export const name = "locus-memory"; export const inject = ["agents", "workingDirectory", "systemPrompt"]; export function apply() {}\n',
    'utf8',
  );
  return distDir;
}

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

function seedDshProfile(dshHome: string, profile = 'desktop') {
  const profileDir = join(dshHome, 'profiles', profile);
  mkdirSync(profileDir, { recursive: true });
  const initialManifest = {
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {
      'dsh-context': '0.87.1',
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-context'],
      },
    },
  };
  const initialPatch = '- id: ui-theme\n  config:\n    preference: light\n';
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify(initialManifest, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(join(profileDir, 'cordis.patch.yml'), initialPatch, 'utf8');
  return { profileDir, initialManifest, initialPatch };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('DeepSeek Harness (dsh) plugin install / doctor / uninstall CLI', () => {
  it('supports dry-run and standalone --target without touching DSH_HOME or LOCUS_HOME/bin', async () => {
    const dshHome = makeTempDir();
    const locusHome = makeTempDir();
    const customTarget = join(makeTempDir(), 'standalone-dsh-plugin');
    const distDir = createFakeDist();
    const env = { DSH_HOME: dshHome, LOCUS_HOME: locusHome };

    const dry = createIo();
    const dryCode = await runCli(
      ['install', 'dsh', '--dry-run', '--capture', 'metadata', '--no-mcp'],
      dry.io,
      { env, startDir: import.meta.dirname },
    );
    expect(dryCode).toBe(0);
    expect(dry.stderr).toEqual([]);
    const dryOut = dry.stdout.join('\n');
    expect(dryOut).toContain('dry-run');
    expect(dryOut).toContain('Capture level: metadata');
    expect(dryOut).toContain('Auto MCP registration: disabled');
    expect(existsSync(join(dshHome, 'profiles', 'desktop'))).toBe(false);

    const targetIo = createIo();
    const targetCode = await runCli(
      ['install', 'dsh', '--target', customTarget, '--capture', 'full', '--no-mcp', '--yes'],
      targetIo.io,
      { env, sourceDistDir: distDir, startDir: import.meta.dirname },
    );
    expect(targetCode).toBe(0);
    expect(targetIo.stderr).toEqual([]);
    expect(existsSync(join(customTarget, 'package.json'))).toBe(true);
    expect(existsSync(join(customTarget, 'cordis.patch.yml'))).toBe(true);
    expect(existsSync(join(customTarget, 'lib', 'index.js'))).toBe(true);
    expect(existsSync(join(customTarget, 'runtime', 'server.js'))).toBe(true);
    expect(existsSync(join(customTarget, 'skills', 'locus-memory', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(locusHome, 'bin'))).toBe(false);

    const patchYml = readFileSync(join(customTarget, 'cordis.patch.yml'), 'utf8');
    expect(patchYml).toContain('captureLevel: full');
    expect(patchYml).toContain('enableMcp: false');
    expect(patchYml).toContain("name: '@deepseek-ai/dsh-skill-filesystem'");

    const doctorIo = createIo();
    expect(await runCli(['doctor', 'dsh', '--target', customTarget], doctorIo.io, { env })).toBe(0);
    expect(doctorIo.stdout.join('\n')).toContain('Status: ok');
  });

  it('installs into a DSH profile with backup, stays idempotent, diagnoses, and cleanly uninstalls', async () => {
    const dshHome = makeTempDir();
    const locusHome = makeTempDir();
    const distDir = createFakeDist();
    const env = { DSH_HOME: dshHome, LOCUS_HOME: locusHome };
    const { profileDir, initialPatch } = seedDshProfile(dshHome, 'desktop');

    const first = createIo();
    expect(
      await runCli(['install', 'dsh', '--yes'], first.io, {
        env,
        sourceDistDir: distDir,
        startDir: import.meta.dirname,
      }),
    ).toBe(0);
    expect(first.stderr).toEqual([]);
    expect(first.stdout.join('\n')).toContain('installed');

    // Backup exists and user cordis.patch.yml stays untouched
    const backups = readdirSync(profileDir).filter((f) => f.startsWith('package.json.bak-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(initialPatch);

    // Manifest preserves prior deps and bundle order while registering locus-memory-dsh
    const updatedManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      dsh: { profile: { bundles: string[] } };
    };
    expect(updatedManifest.dependencies['dsh-context']).toBe('0.87.1');
    expect(updatedManifest.dependencies['locus-memory-dsh']).toMatch(/^file:/);
    expect(updatedManifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-context',
      'locus-memory-dsh',
    ]);

    // Shared runtime + canonical bundle + profile node_modules copy present
    expect(existsSync(join(locusHome, 'bin', 'cli.js'))).toBe(true);
    expect(
      existsSync(join(locusHome, 'plugins', 'dsh', 'locus-memory-dsh', 'lib', 'index.js')),
    ).toBe(true);
    expect(
      existsSync(join(profileDir, 'node_modules', 'locus-memory-dsh', 'lib', 'index.js')),
    ).toBe(true);

    // Doctor reports ok
    const docOk = createIo();
    expect(await runCli(['doctor', 'dsh'], docOk.io, { env })).toBe(0);
    expect(docOk.stdout.join('\n')).toContain('Status: ok');

    // Second install is unchanged and does not emit extra backup
    const second = createIo();
    expect(
      await runCli(['install', 'dsh', '--yes'], second.io, {
        env,
        sourceDistDir: distDir,
        startDir: import.meta.dirname,
      }),
    ).toBe(0);
    expect(second.stdout.join('\n')).toContain('Locus DeepSeek Harness plugin unchanged');
    expect(readdirSync(profileDir).filter((f) => f.startsWith('package.json.bak-'))).toHaveLength(
      1,
    );

    // Updating dsh-plugin.js triggers updated action
    writeFileSync(
      join(distDir, 'dsh-plugin.js'),
      'export const name = "locus-memory"; /* v2 */\n',
      'utf8',
    );
    const third = createIo();
    expect(
      await runCli(['install', 'dsh', '--yes'], third.io, {
        env,
        sourceDistDir: distDir,
        startDir: import.meta.dirname,
      }),
    ).toBe(0);
    expect(third.stdout.join('\n')).toContain('updated');

    // Doctor catches broken bundle when lib/index.js is missing
    rmSync(join(profileDir, 'node_modules', 'locus-memory-dsh', 'lib', 'index.js'));
    const docBroken = createIo();
    expect(await runCli(['doctor', 'dsh'], docBroken.io, { env })).toBe(1);
    expect(docBroken.stdout.join('\n')).toContain('lib/index.js missing');

    // Uninstall requires --yes
    const noYes = createIo();
    expect(await runCli(['uninstall', 'dsh'], noYes.io, { env })).toBe(1);

    // Uninstall --yes restores manifest cleanly while keeping user cordis.patch.yml and memory dir
    const memoryMarker = join(locusHome, 'memory', 'keep.txt');
    mkdirSync(join(locusHome, 'memory'), { recursive: true });
    writeFileSync(memoryMarker, 'keep me\n', 'utf8');

    const removed = createIo();
    expect(await runCli(['uninstall', 'dsh', '--yes'], removed.io, { env })).toBe(0);
    expect(existsSync(join(profileDir, 'node_modules', 'locus-memory-dsh'))).toBe(false);
    expect(existsSync(join(locusHome, 'plugins', 'dsh', 'locus-memory-dsh'))).toBe(false);
    expect(existsSync(memoryMarker)).toBe(true);
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(initialPatch);

    const restoredManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      dsh: { profile: { bundles: string[] } };
    };
    expect(restoredManifest.dependencies).toEqual({ 'dsh-context': '0.87.1' });
    expect(restoredManifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-context',
    ]);

    const docMissing = createIo();
    expect(await runCli(['doctor', 'dsh'], docMissing.io, { env })).toBe(1);
    expect(docMissing.stdout.join('\n')).toContain('Status: missing');
  });

  it('rejects missing profiles, invalid flags, and foreign uninstall targets', async () => {
    const dshHome = makeTempDir();
    const locusHome = makeTempDir();
    const env = { DSH_HOME: dshHome, LOCUS_HOME: locusHome };

    const missingProfile = createIo();
    expect(
      await runCli(['install', 'dsh', '--profile', 'nonexistent', '--yes'], missingProfile.io, {
        env,
        sourceDistDir: createFakeDist(),
        startDir: import.meta.dirname,
      }),
    ).toBe(1);
    expect(missingProfile.stdout.join('\n')).toContain('was not found');

    const badProfile = createIo();
    expect(
      await runCli(['install', 'dsh', '--profile', '../evil', '--yes'], badProfile.io, { env }),
    ).toBe(1);
    expect(badProfile.stderr.join('\n')).toContain('Invalid DeepSeek Harness profile name');

    const badCapture = createIo();
    expect(await runCli(['install', 'dsh', '--capture', 'bogus'], badCapture.io, { env })).toBe(1);
    expect(badCapture.stderr.join('\n')).toContain('--capture');

    const foreignDir = join(makeTempDir(), 'foreign-dsh-plugin');
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(
      join(foreignDir, 'package.json'),
      JSON.stringify({ name: 'someone-else' }),
      'utf8',
    );
    const refused = createIo();
    expect(
      await runCli(['uninstall', 'dsh', '--target', foreignDir, '--yes'], refused.io, { env }),
    ).toBe(1);
    expect(refused.stdout.join('\n')).toContain('Refusing to remove foreign plugin');
    expect(existsSync(foreignDir)).toBe(true);
  });

  it('replaces an existing node_modules symlink/junction without touching the original link target', async () => {
    const dshHome = makeTempDir();
    const locusHome = makeTempDir();
    const externalBundleDir = makeTempDir('locus-dsh-link-src-');
    const distDir = createFakeDist();
    const env = { DSH_HOME: dshHome, LOCUS_HOME: locusHome };
    const { profileDir } = seedDshProfile(dshHome, 'desktop');

    writeFileSync(join(externalBundleDir, 'sentinel.txt'), 'keep original target intact\n', 'utf8');
    const manifestPath = join(profileDir, 'package.json');
    const current = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
      dsh: { profile: { bundles: string[] } };
    };
    current.dependencies['locus-memory-dsh'] = `link:${externalBundleDir.replace(/\\/g, '/')}`;
    current.dsh.profile.bundles.push('locus-memory-dsh');
    writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');

    const profileNodeModules = join(profileDir, 'node_modules');
    const profileLink = join(profileNodeModules, 'locus-memory-dsh');
    mkdirSync(profileNodeModules, { recursive: true });
    symlinkSync(externalBundleDir, profileLink, process.platform === 'win32' ? 'junction' : 'dir');
    expect(lstatSync(profileLink).isSymbolicLink()).toBe(true);

    const io = createIo();
    expect(
      await runCli(['install', 'dsh', '--yes'], io.io, {
        env,
        sourceDistDir: distDir,
        startDir: import.meta.dirname,
      }),
    ).toBe(0);

    expect(lstatSync(profileLink).isSymbolicLink()).toBe(false);
    expect(existsSync(join(externalBundleDir, 'sentinel.txt'))).toBe(true);
    expect(readFileSync(join(externalBundleDir, 'sentinel.txt'), 'utf8')).toBe(
      'keep original target intact\n',
    );
    const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(updated.dependencies['locus-memory-dsh']).toMatch(/^file:/);
  });
});
