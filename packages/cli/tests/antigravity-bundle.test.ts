import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'locus-ag-bundle-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeDist(): string {
  const distDir = join(makeTempDir('locus-ag-dist-'), 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'cli.js'), 'console.log("cli mock v1");\n', 'utf8');
  writeFileSync(join(distDir, 'server.js'), 'console.log("server mock v1");\n', 'utf8');
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('antigravity plugin bundle CLI', () => {
  it('supports dry-run without writing files', async () => {
    const configDir = makeTempDir();
    const locusHome = makeTempDir();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ['install', 'antigravity', '--dry-run', '--capture', 'metadata'],
      io,
      {
        env: {
          LOCUS_ANTIGRAVITY_CONFIG_DIR: configDir,
          LOCUS_HOME: locusHome,
        },
        startDir: import.meta.dirname,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const out = stdout.join('\n');
    expect(out).toContain('dry-run');
    expect(out).toContain('Capture level: metadata');
    expect(out).toContain('config.json: untouched');
    expect(existsSync(join(configDir, 'plugins', 'locus-memory'))).toBe(false);
  });

  it('installs native bundle with root hooks.json, stays idempotent, validates schema, and updates cleanly', async () => {
    const configDir = makeTempDir();
    const locusHome = makeTempDir();
    const distDir = createFakeDist();
    const env = {
      LOCUS_ANTIGRAVITY_CONFIG_DIR: configDir,
      LOCUS_HOME: locusHome,
    };

    const first = createIo();
    const firstCode = await runCli(['install', 'antigravity', '--yes'], first.io, {
      env,
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
    });
    expect(firstCode).toBe(0);
    expect(first.stderr).toEqual([]);
    expect(first.stdout.join('\n')).toContain('installed');

    const pluginDir = join(configDir, 'plugins', 'locus-memory');
    const manifest = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const allowedTopLevel = new Set([
      'name',
      'displayName',
      'version',
      'description',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'logo',
      'disabled',
    ]);
    for (const key of Object.keys(manifest)) {
      expect(allowedTopLevel.has(key), `Unexpected manifest key: ${key}`).toBe(true);
    }
    expect(manifest.name).toBe('locus-memory');
    expect(Array.isArray(manifest.suggestedPrompts)).toBe(true);
    expect((manifest.suggestedPrompts as unknown[]).length).toBe(3);

    const hooks = JSON.parse(readFileSync(join(pluginDir, 'hooks.json'), 'utf8')) as {
      'locus-memory': {
        SessionStart: Array<{ type: string; command: string }>;
        PreInvocation: Array<{ type: string; command: string }>;
        PostToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
        Stop: Array<{ type: string; command: string }>;
      };
    };
    expect(hooks['locus-memory'].SessionStart[0]?.command).toBe(
      'node hooks/locus-hook.mjs session-start',
    );
    expect(hooks['locus-memory'].PreInvocation[0]?.command).toBe(
      'node hooks/locus-hook.mjs pre-invocation',
    );
    expect(hooks['locus-memory'].PostToolUse[0]?.matcher).toBe('*');
    expect(hooks['locus-memory'].PostToolUse[0]?.hooks[0]?.command).toBe(
      'node hooks/locus-hook.mjs post-tool-use',
    );
    expect(hooks['locus-memory'].Stop[0]?.command).toBe('node hooks/locus-hook.mjs stop');
    expect(existsSync(join(pluginDir, 'hooks', 'locus-hook.mjs'))).toBe(true);

    const mcp = JSON.parse(readFileSync(join(pluginDir, 'mcp_config.json'), 'utf8')) as {
      mcpServers: {
        locus: {
          command: string;
          args: string[];
          env: Record<string, string>;
          type?: string;
        };
      };
    };
    const expectedServerArg = ['$', '{PLUGIN_ROOT}/runtime/server.js'].join('');
    expect(mcp.mcpServers.locus.command).toBe('node');
    expect(mcp.mcpServers.locus.args).toEqual([expectedServerArg]);
    expect(mcp.mcpServers.locus.env.LOCUS_CLIENT).toBe('antigravity');
    expect(mcp.mcpServers.locus.env.LOCUS_CAPTURE_LEVEL).toBe('redacted');
    expect('type' in mcp.mcpServers.locus).toBe(false);

    const rules = readFileSync(join(pluginDir, 'rules', 'AGENTS.md'), 'utf8');
    expect(rules.trimStart().startsWith('---')).toBe(false);
    expect(rules).toContain('memory_recall');

    const skill = readFileSync(join(pluginDir, 'skills', 'locus-memory', 'SKILL.md'), 'utf8');
    expect(skill.trimStart().startsWith('---')).toBe(true);
    expect(skill).toContain('name: locus-memory');

    for (const file of ['cli.js', 'server.js', 'package.json', 'runtime.json']) {
      expect(existsSync(join(pluginDir, 'runtime', file))).toBe(true);
      expect(existsSync(join(locusHome, 'bin', file))).toBe(true);
    }

    const second = createIo();
    const secondCode = await runCli(['install', 'antigravity', '--yes'], second.io, {
      env,
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
    });
    expect(secondCode).toBe(0);
    expect(second.stdout.join('\n')).toContain('unchanged');

    writeFileSync(join(distDir, 'cli.js'), 'console.log("cli mock v2");\n', 'utf8');
    const third = createIo();
    const thirdCode = await runCli(['install', 'antigravity', '--yes'], third.io, {
      env,
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
    });
    expect(thirdCode).toBe(0);
    expect(third.stdout.join('\n')).toContain('updated');
  });

  it('rejects invalid --capture flag value', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['install', 'antigravity', '--capture', 'bogus'], io);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--capture');
  });

  it('diagnoses healthy and broken installations with doctor antigravity', async () => {
    const configDir = makeTempDir();
    const locusHome = makeTempDir();
    const customTarget = join(makeTempDir(), 'custom-plugin');
    const distDir = createFakeDist();
    const env = {
      LOCUS_ANTIGRAVITY_CONFIG_DIR: configDir,
      LOCUS_HOME: locusHome,
    };

    const missingIo = createIo();
    const missingCode = await runCli(
      ['doctor', 'antigravity', '--target', customTarget],
      missingIo.io,
      { env },
    );
    expect(missingCode).toBe(1);
    expect(missingIo.stdout.join('\n')).toContain('missing');

    await runCli(['install', 'antigravity', '--target', customTarget, '--yes'], createIo().io, {
      env,
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
    });

    const okIo = createIo();
    const okCode = await runCli(['doctor', 'antigravity', '--target', customTarget], okIo.io, {
      env,
    });
    expect(okCode).toBe(0);
    expect(okIo.stdout.join('\n')).toContain('Status: ok');

    rmSync(join(customTarget, 'runtime', 'cli.js'));
    const brokenIo = createIo();
    const brokenCode = await runCli(
      ['doctor', 'antigravity', '--target', customTarget],
      brokenIo.io,
      {
        env,
      },
    );
    expect(brokenCode).toBe(1);
    expect(brokenIo.stdout.join('\n')).toContain('runtime/cli.js missing');
  });

  it('requires --yes for uninstall and refuses to remove a foreign plugin folder', async () => {
    const configDir = makeTempDir();
    const locusHome = makeTempDir();
    const distDir = createFakeDist();
    const env = {
      LOCUS_ANTIGRAVITY_CONFIG_DIR: configDir,
      LOCUS_HOME: locusHome,
    };

    const withoutYes = createIo();
    expect(await runCli(['uninstall', 'antigravity'], withoutYes.io, { env })).toBe(1);

    await runCli(['install', 'antigravity', '--yes'], createIo().io, {
      env,
      sourceDistDir: distDir,
      startDir: import.meta.dirname,
    });
    const pluginDir = join(configDir, 'plugins', 'locus-memory');
    expect(existsSync(pluginDir)).toBe(true);

    const removed = createIo();
    expect(await runCli(['uninstall', 'antigravity', '--yes'], removed.io, { env })).toBe(0);
    expect(existsSync(pluginDir)).toBe(false);

    const foreignDir = join(makeTempDir(), 'foreign-plugin');
    mkdirSync(foreignDir, { recursive: true });
    writeFileSync(
      join(foreignDir, 'plugin.json'),
      JSON.stringify({ name: 'other-plugin' }),
      'utf8',
    );

    const refused = createIo();
    const refusedCode = await runCli(
      ['uninstall', 'antigravity', '--target', foreignDir, '--yes'],
      refused.io,
      { env },
    );
    expect(refusedCode).toBe(1);
    expect(refused.stdout.join('\n')).toContain('Refusing to remove foreign plugin');
    expect(existsSync(foreignDir)).toBe(true);
  });
});
