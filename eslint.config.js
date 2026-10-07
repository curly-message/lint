import { join } from 'node:path';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// A package may import what its own manifest declares and nothing else, and
// a test, a config or a benchmark may also import the tooling the workspace
// root holds.
const manifests = (directory) => ({
  files: [`${directory}/**`],
  rules: {
    'import-x/no-extraneous-dependencies': ['error', {
      packageDir: [import.meta.dirname, join(import.meta.dirname, directory)],
      // Absolute, since the rule reads a glob against the directory ESLint
      // runs in, and a package's own scripts run it from the package.
      devDependencies: ['*.config.ts', '*.config.js', 'tests/**', 'bench/**'].map((glob) => join(import.meta.dirname, directory, glob)),
    }],
  },
});

export default tseslint.config(
  // Build outputs and machine-local scratch; node_modules is ignored by
  // default. `.claude/worktrees/` is where the agent tooling checks the branch
  // out a second time, and linting a checkout of the repo from inside the
  // repo reports every dev dependency twice.
  { ignores: ['**/dist/', '**/.claude/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    plugins: { 'import-x': importX },
  },
  manifests('lint'),
  manifests('eslint-plugin'),
  {
    // The formatting contract this repository lints by, named in AGENTS.md.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/eol-last': 'error',
      '@stylistic/indent': ['error', 2],
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
    },
  },
  {
    // Plain JS (the configs) sits outside every tsconfig's program — lint it
    // untyped, with node globals.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);
