import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCodexMarketplaceBundle } from '../packages/codex/src/plugin-sync.ts';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const bundleRuntime = args.includes('--bundle-runtime');
const runtimeCliFlagIdx = args.indexOf('--runtime-cli');
const runtimeCliPath =
  runtimeCliFlagIdx !== -1 && args[runtimeCliFlagIdx + 1]
    ? resolve(args[runtimeCliFlagIdx + 1])
    : undefined;

try {
  const result = generateCodexMarketplaceBundle({
    rootDir,
    version: rootPackage.version,
    bundleRuntime,
    ...(runtimeCliPath ? { runtimeCliPath } : {}),
  });

  console.log(`Marketplace root: ${result.marketplaceRoot}`);
  console.log(`Marketplace index: ${result.marketplacePath}`);
  console.log(`Plugin root: ${result.pluginRoot}`);
  console.log(`MCP config: ${result.mcpPath}`);
  console.log(`Hooks: ${result.hooksPath}`);
  console.log(`Skill: ${result.skillPath}`);
  if (result.runtimeDir) {
    console.log(`Bundled runtime: ${result.runtimeDir}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
