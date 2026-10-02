import { defineConfig } from 'tsup';

export default defineConfig(
  (options) => ({
    clean: true,
    dts: true,
    format: ['esm'],
    entry: ['src/index.ts'],
    minify: !options.watch,
    sourcemap: options.watch,
  }),
);
