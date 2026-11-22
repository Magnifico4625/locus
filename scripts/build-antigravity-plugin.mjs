import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = resolve(rootDir, 'dist', 'cli.js');
const serverPath = resolve(rootDir, 'dist', 'server.js');
const targetDir = resolve(rootDir, 'dist', 'antigravity-plugin', 'locus-memory');

if (!existsSync(cliPath) || !existsSync(serverPath)) {
  console.error('Missing built dist/cli.js or dist/server.js. Run `npm run build` first.');
  process.exit(1);
}

execFileSync(
  process.execPath,
  [cliPath, 'install', 'antigravity', '--target', targetDir, '--yes'],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);
