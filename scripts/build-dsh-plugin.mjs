import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = resolve(rootDir, 'dist', 'cli.js');
const serverPath = resolve(rootDir, 'dist', 'server.js');
const dshPluginPath = resolve(rootDir, 'dist', 'dsh-plugin.js');
const targetDir = resolve(rootDir, 'dist', 'dsh-plugin', 'locus-memory-dsh');

if (!existsSync(cliPath) || !existsSync(serverPath) || !existsSync(dshPluginPath)) {
  console.error(
    'Missing built dist/cli.js, dist/server.js, or dist/dsh-plugin.js. Run `npm run build` first.',
  );
  process.exit(1);
}

execFileSync(process.execPath, [cliPath, 'install', 'dsh', '--target', targetDir, '--yes'], {
  cwd: rootDir,
  stdio: 'inherit',
});
