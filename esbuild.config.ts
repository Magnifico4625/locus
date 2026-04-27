import * as esbuild from 'esbuild';

const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  minify: false,
  external: ['node:*', 'sql.js'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  logLevel: 'info',
} satisfies esbuild.BuildOptions;

await Promise.all([
  esbuild.build({
    ...commonOptions,
    entryPoints: ['packages/core/src/server.ts'],
    outfile: 'dist/server.js',
  }),
  esbuild.build({
    ...commonOptions,
    entryPoints: ['packages/cli/src/index.ts'],
    outfile: 'dist/cli.js',
  }),
]);
