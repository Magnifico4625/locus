import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveCodexConfigPath,
  resolveCodexHome,
  resolveCodexSkillPath,
} from '../src/codex/paths.js';
import { installCodexSkill } from '../src/codex/skill.js';
import { runCli } from '../src/index.js';

const tempDirs: string[] = [];
const repoRoot = join(import.meta.dirname, '..', '..', '..');

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-install-'));
  tempDirs.push(dir);
  return dir;
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

describe('codex install model', () => {
  it('resolves default and explicit Codex paths', () => {
    const explicitHome = makeTempDir();

    expect(resolveCodexHome({ CODEX_HOME: explicitHome })).toBe(explicitHome);
    expect(resolveCodexHome({}).replaceAll('\\', '/')).toMatch(/\/\.codex$/);
    expect(resolveCodexConfigPath({ CODEX_HOME: explicitHome })).toBe(
      join(explicitHome, 'config.toml'),
    );
    expect(resolveCodexSkillPath({ CODEX_HOME: explicitHome }, 'locus-memory')).toBe(
      join(explicitHome, 'skills', 'locus-memory', 'SKILL.md'),
    );
  });

  it('creates the Codex skill directory and writes SKILL.md atomically', () => {
    const root = makeTempDir();
    const codexHome = join(root, 'codex-home');
    const sourcePath = join(root, 'source', 'SKILL.md');
    mkdirSync(join(root, 'source'), { recursive: true });
    writeFileSync(sourcePath, '# skill\n', 'utf8');

    const result = installCodexSkill({
      env: { CODEX_HOME: codexHome },
      sourcePath,
    });

    expect(result.action).toBe('created');
    expect(result.targetPath).toBe(join(codexHome, 'skills', 'locus-memory', 'SKILL.md'));
    expect(readFileSync(result.targetPath, 'utf8')).toBe('# skill\n');
    expect(existsSync(`${result.targetPath}.locus-tmp`)).toBe(false);
  });

  it('resolves the packaged canonical skill from source layout', () => {
    const result = installCodexSkill({
      env: { CODEX_HOME: makeTempDir() },
    });

    expect(result.action).toBe('created');
    expect(readFileSync(result.targetPath, 'utf8')).toContain('memory_recall');
  });

  it('reports unchanged for identical skill content', () => {
    const root = makeTempDir();
    const targetPath = join(root, 'codex-home', 'skills', 'locus-memory', 'SKILL.md');
    const sourcePath = join(root, 'source.md');
    mkdirSync(join(root, 'codex-home', 'skills', 'locus-memory'), { recursive: true });
    writeFileSync(sourcePath, '# same\n', 'utf8');
    writeFileSync(targetPath, '# same\n', 'utf8');

    const result = installCodexSkill({
      env: { CODEX_HOME: join(root, 'codex-home') },
      sourcePath,
    });

    expect(result.action).toBe('unchanged');
  });

  it('backs up differing skill content with a timestamp before overwrite', () => {
    const root = makeTempDir();
    const codexHome = join(root, 'codex-home');
    const targetPath = join(codexHome, 'skills', 'locus-memory', 'SKILL.md');
    const sourcePath = join(root, 'source.md');
    mkdirSync(join(codexHome, 'skills', 'locus-memory'), { recursive: true });
    writeFileSync(sourcePath, '# canonical\n', 'utf8');
    writeFileSync(targetPath, '# local\n', 'utf8');

    const result = installCodexSkill({
      env: { CODEX_HOME: codexHome },
      sourcePath,
      overwrite: true,
      backup: true,
      now: new Date('2026-04-27T10:20:30.000Z'),
    });

    expect(result.action).toBe('updated');
    expect(result.backup?.action).toBe('backed_up');
    expect(result.backup?.path).toMatch(/SKILL\.md\.20260427T102030000Z\.bak$/);
    expect(readFileSync(targetPath, 'utf8')).toBe('# canonical\n');
    expect(readFileSync(result.backup?.path ?? '', 'utf8')).toBe('# local\n');
  });

  it('reports permission errors without claiming success', () => {
    const root = makeTempDir();
    const sourcePath = join(root, 'source.md');
    writeFileSync(sourcePath, '# skill\n', 'utf8');

    const result = installCodexSkill({
      env: { CODEX_HOME: join(root, 'codex-home') },
      sourcePath,
      writeFile: () => {
        const error = new Error('access denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
    });

    expect(result.action).toBe('skipped');
    expect(result.error?.code).toBe('permission_denied');
  });

  it('dry-run install reports skill path and default redacted capture without writing files', async () => {
    const codexHome = makeTempDir();
    const { io, stdout } = createIo();

    const exitCode = await runCli(['install', 'codex', '--dry-run'], io, {
      env: { CODEX_HOME: codexHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain(join(codexHome, 'skills', 'locus-memory', 'SKILL.md'));
    expect(stdout.join('\n')).toContain('LOCUS_CODEX_CAPTURE=redacted');
    expect(existsSync(join(codexHome, 'skills'))).toBe(false);
  });

  it('dry-run reports stale lock and temp files without removing them', async () => {
    const codexHome = makeTempDir();
    const staleTemp = join(codexHome, 'skills', 'locus-memory', 'SKILL.md.locus-tmp');
    const staleLock = join(codexHome, '.locus-install.lock');
    mkdirSync(join(codexHome, 'skills', 'locus-memory'), { recursive: true });
    writeFileSync(staleTemp, '# partial\n', 'utf8');
    writeFileSync(staleLock, '{}', 'utf8');
    const { io, stdout } = createIo();

    const exitCode = await runCli(['install', 'codex', '--dry-run'], io, {
      env: { CODEX_HOME: codexHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('\n')).toContain(`Install lock: present at ${staleLock}`);
    expect(stdout.join('\n')).toContain('Stale temp files: 1');
    expect(existsSync(staleTemp)).toBe(true);
    expect(existsSync(staleLock)).toBe(true);
  });

  it('installs Codex MCP config and skill with a lock when confirmed', async () => {
    const codexHome = makeTempDir();
    const commands: Array<{ command: string; args: string[] }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['install', 'codex', '--yes'], io, {
      env: { CODEX_HOME: codexHome },
      startDir: repoRoot,
      platform: 'linux',
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(exitCode).toBe(0);
    expect(commands[0]).toEqual({
      command: 'npm',
      args: ['exec', '-y', 'locus-memory@3.4.0', '--', '--help'],
    });
    expect(commands[1]).toEqual({
      command: 'codex',
      args: ['mcp', 'get', 'locus'],
    });
    expect(commands[2]).toEqual({
      command: 'codex',
      args: expect.arrayContaining([
        'mcp',
        'add',
        'locus',
        '--',
        'npx',
        '-y',
        'locus-memory@3.4.0',
        'mcp',
      ]),
    });
    expect(existsSync(join(codexHome, '.locus-install.lock'))).toBe(false);
    expect(readFileSync(join(codexHome, 'skills', 'locus-memory', 'SKILL.md'), 'utf8')).toContain(
      'memory_recall',
    );
    expect(stdout.join('\n')).toContain('Skill: created');
  });

  it('does not mutate Codex config when the pinned runtime package is unavailable', async () => {
    const codexHome = makeTempDir();
    const commands: Array<{ command: string; args: string[] }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['install', 'codex', '--yes'], io, {
      env: { CODEX_HOME: codexHome },
      startDir: repoRoot,
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        return { exitCode: 1, stdout: '', stderr: 'package not found' };
      },
    });

    expect(exitCode).toBe(1);
    expect(commands).toEqual([
      {
        command: 'npm',
        args: ['exec', '-y', 'locus-memory@3.4.0', '--', '--help'],
      },
    ]);
    expect(stdout.join('\n')).toContain('Runtime package unavailable');
    expect(existsSync(join(codexHome, 'skills'))).toBe(false);
  });

  it('migrates an existing manual locus MCP entry before adding package runtime', async () => {
    const codexHome = makeTempDir();
    const commands: Array<{ command: string; args: string[] }> = [];
    const { io, stdout } = createIo();

    const exitCode = await runCli(['install', 'codex', '--yes'], io, {
      env: { CODEX_HOME: codexHome },
      startDir: repoRoot,
      platform: 'linux',
      commandRunner: async (command, args) => {
        commands.push({ command, args });
        if (args.join(' ') === 'mcp get locus') {
          return {
            exitCode: 0,
            stdout: 'locus\n  command: node\n  args: C:\\Users\\Admin\\locus\\dist\\server.js\n',
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(exitCode).toBe(0);
    expect(commands.map((entry) => entry.args.join(' '))).toEqual([
      'exec -y locus-memory@3.4.0 -- --help',
      'mcp get locus',
      'mcp remove locus',
      expect.stringContaining('mcp add'),
    ]);
    expect(stdout.join('\n')).toContain('Existing MCP entry: manual-locus');
  });
});
