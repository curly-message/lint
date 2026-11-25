import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // The source imports the core's bytes as the build inlines them, which
  // this states before Vite reads the file as a module of its own.
  plugins: [{
    name: 'core.wasm',
    enforce: 'pre',
    load: (id) => (id.endsWith('.wasm') ? `export default ${JSON.stringify(readFileSync(id, 'base64'))};` : undefined),
  }],
  // The suite imports the package by its name: from the source, and under
  // `--mode dist` from the build a release ships. `#internal` is what the
  // fixtures' runner reaches beside it, from the same build.
  resolve: {
    alias: {
      '@curly-message/lint': mode === 'dist' ? '/dist/index.js' : '/src/index.ts',
      '#internal': mode === 'dist' ? '/dist/internal.js' : '/src/internal.ts',
    },
  },
  test: {
    // A run against the source compiles the core first, so that it lints
    // with the crate as it stands; one against the build tests what the
    // build holds.
    globalSetup: mode === 'dist' ? [] : ['./tests/core.setup.ts'],
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
}));
