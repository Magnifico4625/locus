import { syncCodexPluginBundle } from '../packages/codex/src/plugin-sync.ts';

try {
  const result = syncCodexPluginBundle();

  console.log(`Canonical skill: ${result.sourcePath}`);
  console.log(`Plugin root: ${result.pluginRoot}`);
  console.log(`Plugin skill synced: ${result.targetPath}`);
  if (!result.changed) {
    console.log('Plugin skill already matched canonical skill.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
