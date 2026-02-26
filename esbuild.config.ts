import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['packages/core/src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: true,
  minify: false,
  external: ['node:*', 'sql.js'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  logLevel: 'info',
});
