import * as esbuild from 'esbuild';

const libraryOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  external: ['node:*', 'sql.js'],
  logLevel: 'info',
} satisfies esbuild.BuildOptions;

const commonOptions = {
  ...libraryOptions,
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
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
  esbuild.build({
    ...libraryOptions,
    entryPoints: ['packages/cli/src/dsh/plugin.ts'],
    outfile: 'dist/dsh-plugin.js',
  }),
]);
