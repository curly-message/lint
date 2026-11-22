import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
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
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
}));
