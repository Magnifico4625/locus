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

    expect(skill).toContain('memory_recall');
    expect(skill).toContain('memory_search');
    expect(skill).toContain('auto-import');
    expect(skill).toContain('memory_status');
    expect(skill).toContain('memory_import_codex');
    expect(skill).toContain('manual');
    expect(skill).toContain('memory_remember');
    expect(skill).toContain('architecture');
    expect(skill).toContain('memory_scan');
    expect(skill).toContain('memory_timeline');
  });

  it('teaches Codex to check Locus before claiming memory loss', () => {
    const skill = readSkill();

    expect(skill).toMatch(/Always check Locus before saying you do not remember/i);
    expect(skill).toContain('needs_clarification');
    expect(skill).toContain('fall back to `memory_search` or `memory_timeline`');
    expect(skill).toContain('after the lookup');
  });

  it('does not require memory_import_codex before every history search', () => {
    const skill = readSkill();

    expect(skill).not.toMatch(/always run [`']?memory_import_codex[`']? before/i);
    expect(skill).not.toMatch(/before history-related searches.*memory_import_codex/i);
  });
});
