import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('GitHub Pages landing page', () => {
  const repoRoot = resolve(process.cwd());
  const siteDir = resolve(repoRoot, 'docs');
  const indexPath = resolve(siteDir, 'index.html');
  const readRepoFile = (relativePath: string) =>
    readFileSync(resolve(repoRoot, relativePath), 'utf-8');

  it('ships a dedicated index.html for GitHub Pages', () => {
    expect(existsSync(indexPath)).toBe(true);
  });

  it('describes the current v3.5.0 product state honestly', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).toContain('v3.5.0');
    expect(html).toContain('one-command install');
    expect(html).toContain('redacted');
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).not.toContain('v3.1.0 is out');
    expect(html).not.toContain('desktop / extension parity is validated');
  });

  it('uses real public CTAs instead of a fake install command', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).toContain('https://github.com/Magnifico4625/locus');
    expect(html).not.toContain('$ git clone .../locus');
  });

  it('does not depend on the Tailwind CDN at runtime', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).toContain('./app.css');
  });

  it('keeps Codex install documentation honest and package-first', () => {
    const readme = readRepoFile('README.md');
    const codexReadme = readRepoFile('packages/codex/README.md');
    const configExample = readRepoFile('packages/codex/config/config.toml.example');

    expect(readme).toContain('npx -y locus-memory@latest install codex');
    expect(readme).toContain('Manual MCP fallback');
    expect(readme).toContain('codex mcp add locus -- node /path/to/locus/dist/server.js');
    expect(readme).not.toContain('desktop/extension parity is validated');

    expect(codexReadme).toContain('npx -y locus-memory@latest install codex');
    expect(codexReadme).toContain('doctor codex');
    expect(codexReadme).toContain('uninstall codex');

    expect(configExample).toContain('locus-memory@3.5.0');
    expect(configExample).toContain('npx.cmd');
    expect(configExample).not.toContain('args = ["-y", "locus-memory@latest", "mcp"]');
    expect(configExample).not.toContain('coming soon');
  });
});
