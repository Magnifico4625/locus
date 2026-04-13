import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillPath = join(import.meta.dirname, '..', 'skills', 'locus-memory', 'SKILL.md');

function readSkill(): string {
  return readFileSync(skillPath, 'utf8');
}

describe('locus-memory skill contract', () => {
  it('documents the phase 4 Codex memory workflow', () => {
    const skill = readSkill();

    expect(skill).toContain('memory_search');
    expect(skill).toContain('auto-import');
    expect(skill).toContain('memory_status');
    expect(skill).toContain('memory_import_codex');
    expect(skill).toContain('manual');
    expect(skill).toContain('memory_remember');
    expect(skill).toContain('architecture');
    expect(skill).toContain('memory_scan');
  });

  it('does not require memory_import_codex before every history search', () => {
    const skill = readSkill();

    expect(skill).not.toMatch(/always run [`']?memory_import_codex[`']? before/i);
    expect(skill).not.toMatch(/before history-related searches.*memory_import_codex/i);
  });
});
