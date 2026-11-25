import { defineConfig } from 'tsup';

export default defineConfig(
  (options) => ({
    clean: true,
    dts: { entry: 'src/index.ts' },
    format: ['esm'],
    // The core's bytes, which the package decodes when it first lints.
    loader: { '.wasm': 'base64' },
    entry: ['src/index.ts', 'src/cli.ts', 'src/internal.ts'],
    minify: !options.watch,
    sourcemap: options.watch,
    splitting: true,
  }),
);
