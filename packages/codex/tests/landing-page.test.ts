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

  it('describes the current v3.7.0 product state honestly', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).toContain('v3.7.0');
    expect(html).toContain('Track D');
    expect(html).toContain('one-command install');
    expect(html).toContain('npx -y locus-memory@latest install codex');
    expect(html).toContain('copy-install-button');
    expect(html).toContain('redacted');
    expect(html).toContain('recommended rich recall');
    expect(html).toContain('full');
    expect(html).toContain('explicit privacy warning');
    expect(html).toContain('memory_recall');
    expect(html).toContain('memory reliability');
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).not.toContain('v3.1.0 is out');
    expect(html).not.toContain('desktop / extension parity is validated');
  });

  it('uses real public CTAs instead of a fake install command', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).toContain('https://github.com/Magnifico4625/locus');
    expect(html).toContain('Copy command');
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
    const acceptanceMatrix = readRepoFile('docs/codex-acceptance-matrix.md');
    const roadmap = readRepoFile('docs/roadmap/codex-next.md');
    const releaseNotes = readRepoFile('docs/releases/v3.7.0.md');

    expect(readme).toContain('npx -y locus-memory@latest install codex');
    expect(readme).toContain('Manual MCP fallback');
    expect(readme).toContain('codex mcp add locus -- node /path/to/locus/dist/server.js');
    expect(readme).toContain('New in v3.7');
    expect(readme).toContain('Track D');
    expect(readme).toContain('candidateGroups');
    expect(readme).toContain('memory_calendar');
    expect(readme).toContain('memory_project_state');
    expect(readme).toContain('full` is maximum recall');
    expect(readme).not.toContain('desktop/extension parity is validated');

    expect(codexReadme).toContain('npx -y locus-memory@latest install codex');
    expect(codexReadme).toContain('doctor codex');
    expect(codexReadme).toContain('uninstall codex');
    expect(codexReadme).toContain('Track D');
    expect(codexReadme).toContain('Track C');
    expect(codexReadme).toContain('memory_review');
    expect(codexReadme).toContain('candidateGroups');
    expect(codexReadme).toContain('Codex hooks are optional');

    expect(configExample).toContain('locus-memory@3.7.0');
    expect(configExample).toContain('npx.cmd');
    expect(configExample).not.toContain('args = ["-y", "locus-memory@latest", "mcp"]');
    expect(configExample).not.toContain('coming soon');

    expect(acceptanceMatrix).toContain('Track D');
    expect(acceptanceMatrix).toContain('track-c-recall-acceptance.test.ts');
    expect(acceptanceMatrix).toContain('candidateGroups');
    expect(acceptanceMatrix).toContain('Desktop MCP marker path accepted');
    expect(acceptanceMatrix).toContain('previous MCP tool registry until reload');
    expect(acceptanceMatrix).toContain('extension parity pending');

    expect(roadmap).toContain('Track D');
    expect(roadmap).toContain('shipped in `v3.6.0`');
    expect(roadmap).toContain('v3.7.0');

    expect(releaseNotes).toContain('Locus v3.7.0 Release Notes');
    expect(releaseNotes).toContain('Track D');
    expect(releaseNotes).toContain('memory_calendar');
    expect(releaseNotes).toContain('memory_project_state');
    expect(releaseNotes).toContain('Known Boundaries');
    expect(releaseNotes).toContain('live Desktop sessions may need a reload');
  });
});
