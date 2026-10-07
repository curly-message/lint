// The rows `../bench/harness.mjs` measures, each on the build in `dist/`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import json from '@eslint/json';
import { Linter } from 'eslint';
import plugin from '../dist/index.js';

const bundle = () => readFileSync(new URL('../dist/index.js', import.meta.url));

const MESSAGES = [
  'Hello, {{name}}!',
  '{{name}} has {{count:number}} new {{count:plural; one:message; other:messages}}.',
  '{{gender; male:He; female:She; default:They}} replied to {{thread}}.',
  '{{count:plural; one:{{count}} file; other:{{count}} files}} in {{folder; :the root; default:{{folder}}}}.',
  'Total: {{amount:number}}, due {{due:date}}.',
];

const CONFIG = [
  { files: ['**/*.js'], ...plugin.configs.recommended },
  { files: ['**/*.json'], language: 'json/json', plugins: { json, '@curly-message': plugin }, rules: plugin.configs.recommended.rules },
];

const linting = (text, filename) => {
  const linter = new Linter({ configType: 'flat' });

  return () => linter.verify(text, CONFIG, { filename });
};

export default [
  { name: 'dist/index.js', kind: 'size', run: () => bundle().length },
  { name: 'dist/index.js, gzipped', kind: 'size', run: () => gzipSync(bundle(), { level: 9 }).length },
  { name: 'ESLint: a JSON catalogue of 1 000 messages', kind: 'time', run: () => {
    const tree = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`m${index}`, MESSAGES[index % MESSAGES.length]]));

    return linting(JSON.stringify(tree, null, 2), 'locales/en/common.json');
  } },
  { name: 'ESLint: a module of 100 resolve calls', kind: 'time', run: () => {
    const text = Array.from({ length: 100 }, (_, index) => `resolve(${JSON.stringify(MESSAGES[index % MESSAGES.length])}, payload);`).join('\n');

    return linting(text, 'src/app.js');
  } },
];
