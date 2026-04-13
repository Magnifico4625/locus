import { copyCodexSkill } from '../packages/codex/src/skill-sync.ts';

const args = new Set(process.argv.slice(2));
const overwrite = args.has('--force');
const backup = overwrite || args.has('--backup');

try {
  const result = copyCodexSkill({
    env: process.env,
    overwrite,
    backup,
  });

  console.log(`Canonical skill: ${result.sourcePath}`);
  console.log(`Installed skill: ${result.targetPath}`);
  if (result.changed) {
    if (result.backupPath) {
      console.log(`Backup created: ${result.backupPath}`);
    }
    console.log('Codex skill synced.');
  } else {
    console.log('Installed skill already matches canonical skill.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
