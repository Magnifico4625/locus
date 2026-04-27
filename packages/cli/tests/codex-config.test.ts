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

    const server = buildMcpServerConfig({ version: '3.4.0', platform: 'win32' });
    expect(server.command).toBe('npx.cmd');
    expect(server.args).toEqual(['-y', 'locus-memory@3.4.0', 'mcp']);
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
        args: ['-y', 'locus-memory@3.4.0', 'mcp'],
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
    expect(renderMcpTomlBlock('locus', { command: 'node', args: [path], env: {} })).toContain(
      '"C:\\\\Users\\\\Admin\\\\My Project\\\\dist\\\\server.js"',
    );
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
      version: '3.4.0',
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
      'locus-memory@3.4.0',
      'mcp',
    ]);
    expect(buildCodexMcpRemoveArgs('locus')).toEqual(['mcp', 'remove', 'locus']);
  });
});
