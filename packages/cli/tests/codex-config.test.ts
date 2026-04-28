import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCodexMcpAddArgs,
  buildCodexMcpRemoveArgs,
  detectNpxCommand,
} from '../src/codex/commands.js';
import {
  buildMcpServerConfig,
  classifyMcpOwnership,
  createConfigBackup,
  quoteTomlBasicString,
  renderMcpTomlBlock,
  setMcpServerCwd,
} from '../src/codex/config.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'locus-cli-codex-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex mcp config model', () => {
  it('builds a pinned package MCP server for the current platform', () => {
    expect(detectNpxCommand('linux')).toBe('npx');
    expect(detectNpxCommand('win32')).toBe('npx.cmd');

    const server = buildMcpServerConfig({
      version: '3.5.2',
      platform: 'win32',
      cwd: 'C:\\Users\\Admin\\.codex',
    });
    expect(server.command).toBe('npx.cmd');
    expect(server.args).toEqual(['-y', 'locus-memory@3.5.2', 'mcp']);
    expect(server.cwd).toBe('C:\\Users\\Admin\\.codex');
    expect(server.args.join(' ')).not.toContain('@latest');
    expect(server.env).toEqual({
      LOCUS_LOG: 'error',
      LOCUS_CODEX_CAPTURE: 'redacted',
      LOCUS_CAPTURE_LEVEL: 'redacted',
    });
  });

  it('classifies ownership states explicitly', () => {
    expect(classifyMcpOwnership(undefined)).toBe('missing');
    expect(
      classifyMcpOwnership({
        command: 'npx',
        args: ['-y', 'locus-memory@3.5.2', 'mcp'],
        cwd: 'C:/Users/Admin/.codex',
      }),
    ).toBe('package-owned');
    expect(
      classifyMcpOwnership({
        command: 'node',
        args: ['C:/Users/Admin/locus/dist/server.js'],
      }),
    ).toBe('manual-locus');
    expect(
      classifyMcpOwnership({
        command: 'node',
        args: ['C:\\Users\\Admin\\gemini-project\\ClaudeMagnificoMem\\dist\\server.js'],
      }),
    ).toBe('manual-locus');
    expect(
      classifyMcpOwnership({
        command: 'node',
        args: ['C:/other/server.js'],
      }),
    ).toBe('foreign-locus');
  });

  it('renders dirty Windows paths safely in fallback TOML', () => {
    const path = 'C:\\Users\\Admin\\My Project\\dist\\server.js';

    expect(quoteTomlBasicString(path)).toBe(
      '"C:\\\\Users\\\\Admin\\\\My Project\\\\dist\\\\server.js"',
    );
    expect(quoteTomlBasicString('C:\\bad"path')).toContain('\\"');
    const rendered = renderMcpTomlBlock('locus', { command: 'node', args: [path], env: {} });
    expect(rendered).toContain('"C:\\\\Users\\\\Admin\\\\My Project\\\\dist\\\\server.js"');
  });

  it('creates a backup before direct config edits', () => {
    const root = makeTempDir();
    const configPath = join(root, 'config.toml');
    writeFileSync(configPath, '[mcp_servers]\n', 'utf8');

    const backupPath = createConfigBackup(configPath, new Date('2026-04-27T10:20:30.000Z'));

    expect(backupPath).toMatch(/config\.toml\.20260427T102030000Z\.bak$/);
    expect(readFileSync(backupPath, 'utf8')).toBe('[mcp_servers]\n');
  });

  it('builds codex mcp add/remove args without shell concatenation', () => {
    const addArgs = buildCodexMcpAddArgs({
      name: 'locus',
      version: '3.5.2',
      platform: 'linux',
    });

    expect(addArgs).toEqual([
      'mcp',
      'add',
      '--env',
      'LOCUS_LOG=error',
      '--env',
      'LOCUS_CODEX_CAPTURE=redacted',
      '--env',
      'LOCUS_CAPTURE_LEVEL=redacted',
      'locus',
      '--',
      'npx',
      '-y',
      'locus-memory@3.5.2',
      'mcp',
    ]);
    expect(buildCodexMcpRemoveArgs('locus')).toEqual(['mcp', 'remove', 'locus']);
  });

  it('adds a safe cwd to the locus MCP TOML block after codex mcp add', () => {
    const root = makeTempDir();
    const configPath = join(root, 'config.toml');
    writeFileSync(
      configPath,
      [
        '[mcp_servers.locus]',
        'command = "npx.cmd"',
        'args = ["-y", "locus-memory@3.5.2", "mcp"]',
        '',
        '[mcp_servers.locus.env]',
        'LOCUS_CAPTURE_LEVEL = "redacted"',
        '',
        '[projects."C:\\\\Users\\\\Admin\\\\project"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = setMcpServerCwd(
      configPath,
      'locus',
      'C:\\Users\\Admin\\.codex',
      new Date('2026-04-28T13:30:00.000Z'),
    );

    expect(result.action).toBe('updated');
    expect(result.backupPath).toMatch(/config\.toml\.20260428T133000000Z\.bak$/);
    expect(readFileSync(configPath, 'utf8')).toContain('cwd = "C:\\\\Users\\\\Admin\\\\.codex"');
    expect(readFileSync(configPath, 'utf8')).toContain('[mcp_servers.locus.env]');
  });

  it('updates an existing cwd in the locus MCP TOML block', () => {
    const root = makeTempDir();
    const configPath = join(root, 'config.toml');
    writeFileSync(
      configPath,
      [
        '[mcp_servers.locus]',
        'command = "npx.cmd"',
        'args = ["-y", "locus-memory@3.5.2", "mcp"]',
        'cwd = "C:\\\\old"',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = setMcpServerCwd(
      configPath,
      'locus',
      'C:\\Users\\Admin\\.codex',
      new Date('2026-04-28T13:30:00.000Z'),
    );

    expect(result.action).toBe('updated');
    expect(readFileSync(configPath, 'utf8')).toContain('cwd = "C:\\\\Users\\\\Admin\\\\.codex"');
    expect(readFileSync(configPath, 'utf8')).not.toContain('cwd = "C:\\\\old"');
  });
});
