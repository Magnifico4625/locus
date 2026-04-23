import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('GitHub Pages landing page', () => {
  const repoRoot = resolve(process.cwd());
  const siteDir = resolve(repoRoot, 'docs');
  const indexPath = resolve(siteDir, 'index.html');

  it('ships a dedicated index.html for GitHub Pages', () => {
    expect(existsSync(indexPath)).toBe(true);
  });

  it('describes the current v3.4.0 product state honestly', () => {
    const html = readFileSync(indexPath, 'utf-8');

    expect(html).toContain('v3.4.0');
    expect(html).toContain('redacted');
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
    expect(html).not.toContain('v3.1.0 is out');
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
});
