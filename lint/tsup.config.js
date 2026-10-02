import { defineConfig } from 'tsup';

export default defineConfig(
  (options) => ({
    clean: true,
    dts: { entry: 'src/index.ts' },
    format: ['esm'],
    entry: ['src/index.ts', 'src/cli.ts'],
    minify: !options.watch,
    sourcemap: options.watch,
    splitting: true,
  }),
);
