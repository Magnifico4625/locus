# Slash Commands Fix — Design

> Date: 2026-02-23
> Author: Magnifico4625 + Claude
> Status: Approved

## Problem

`skills/memory/SKILL.md` registers as a single skill `/locus:memory`. Individual
commands like `/memory-doctor` are not recognized. The `triggers:` field in
frontmatter is not a standard Claude Code field and is ignored.

Claude Code registers one skill per `skills/<name>/SKILL.md` directory.

## Solution: Approach A — Separate SKILL.md per command

Replace the single `skills/memory/SKILL.md` with 6 individual skill directories.

### Target structure

```
skills/
├── remember/SKILL.md        → /locus:remember <text>
├── forget/SKILL.md          → /locus:forget <query>
├── memory-status/SKILL.md   → /locus:memory-status
├── memory-doctor/SKILL.md   → /locus:memory-doctor
├── memory-audit/SKILL.md    → /locus:memory-audit
└── memory-purge/SKILL.md    → /locus:memory-purge
```

### Skill frontmatter per command

Each SKILL.md uses standard Claude Code frontmatter:

- `name` — command name (becomes `/locus:<name>`)
- `description` — when Claude should auto-invoke this skill
- `argument-hint` — for commands that take arguments (remember, forget)
- `disable-model-invocation` — true for purge (destructive)

### Files to delete

- `skills/memory/SKILL.md` — replaced by 6 individual skills

### Files to create

6 new SKILL.md files (see implementation plan for content)

### Files to modify

None — no code changes needed.
