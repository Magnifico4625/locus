import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCodexMarketplaceBundle } from '../packages/codex/src/plugin-sync.ts';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));

try {
  const result = generateCodexMarketplaceBundle({
    rootDir,
    version: rootPackage.version,
  });

  console.log(`Marketplace root: ${result.marketplaceRoot}`);
  console.log(`Marketplace index: ${result.marketplacePath}`);
  console.log(`Plugin root: ${result.pluginRoot}`);
  console.log(`MCP config: ${result.mcpPath}`);
  console.log(`Skill: ${result.skillPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
