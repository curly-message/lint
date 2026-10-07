// The rows `../bench/harness.mjs` measures, each on the build in `dist/`.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { lintCatalogue, lintMessage, readCatalogue } from '../dist/index.js';

const bundle = () => Buffer.concat(readdirSync(new URL('../dist/', import.meta.url)).filter((name) => name.endsWith('.js')).sort().map((name) => readFileSync(new URL(`../dist/${name}`, import.meta.url))));

// Messages as a catalogue holds them, each in English and in Czech, whose
// plural rules take four categories.
const MESSAGES = [
  ['Hello, {{name}}!', 'Ahoj, {{name}}!'],
  ['{{name}} has {{count:number}} new {{count:plural; one:message; other:messages}}.', '{{name}} m\u00e1 {{count:number}} {{count:plural; one:novou zpr\u00e1vu; few:nov\u00e9 zpr\u00e1vy; many:nov\u00e9 zpr\u00e1vy; other:nov\u00fdch zpr\u00e1v}}.'],
  ['{{gender; male:He; female:She; default:They}} replied to {{thread}}.', '{{gender; male:Odpov\u011bd\u011bl; female:Odpov\u011bd\u011bla; default:Odpov\u011bd\u011bli}} na {{thread}}.'],
  ['{{count:plural; one:{{count}} file; other:{{count}} files}} in {{folder; :the root; default:{{folder}}}}.', '{{count:plural; one:{{count}} soubor; few:{{count}} soubory; many:{{count}} souboru; other:{{count}} soubor\u016f}} v {{folder; :ko\u0159eni; default:{{folder}}}}.'],
  ['Total: {{amount:number}}, due {{due:date}}.', 'Celkem: {{amount:number}}, splatn\u00e9 {{due:date}}.'],
];

// A catalogue of `count` messages in each of two locales, a hundred to a
// namespace.
const catalogue = (count) => {
  const tree = (side) => {
    const locale = {};

    for (let index = 0; index < count; index += 1) {
      const namespace = (locale[`ns${Math.floor(index / 100)}`] ??= {});

      namespace[`m${index}`] = MESSAGES[index % MESSAGES.length][side];
    }

    return locale;
  };

  return { en: tree(0), cs: tree(1) };
};

// What linting a catalogue of 1 000 messages a locale reads of it: every trap
// a read of any object in it can go through, counted.
const reads = () => {
  let count = 0;
  const handler = Object.fromEntries(['get', 'has', 'getOwnPropertyDescriptor', 'ownKeys', 'getPrototypeOf'].map((trap) => [trap, (...args) => {
    count += 1;

    return Reflect[trap](...args);
  }]));
  const watched = (value) => (value && typeof value === 'object' ? new Proxy(Object.fromEntries(Object.entries(value).map(([key, member]) => [key, watched(member)])), handler) : value);

  lintCatalogue(watched(catalogue(1000)));

  return count;
};

export default [
  { name: 'dist/*.js', kind: 'size', run: () => bundle().length },
  { name: 'dist/*.js, gzipped', kind: 'size', run: () => gzipSync(bundle(), { level: 9 }).length },
  { name: 'catalogue reads: linting 1 000 messages in two locales', kind: 'count', run: reads },
  { name: 'lintMessage: five catalogue messages, with their locale', kind: 'time', run: () => () => {
    for (const [, message] of MESSAGES) lintMessage(message, { locale: 'cs' });
  } },
  { name: 'lintMessage: 20 000 unclosed placeholders', kind: 'time', run: () => {
    const message = '{{\n'.repeat(20000);

    return () => lintMessage(message);
  } },
  { name: 'lintMessage: a selection of 20 000 options', kind: 'time', run: () => {
    const message = `{{v; ${Array.from({ length: 20000 }, (_, index) => `k${index}:x`).join('; ')}}}`;

    return () => lintMessage(message);
  } },
  { name: 'lintCatalogue: 20 000 placeholders and a plural of 40 000 keys, in two locales', kind: 'time', run: () => {
    const message = Array.from({ length: 20000 }, (_, index) => `{{p${index}}}`).join(' ');
    const plural = `{{n:plural; ${Array.from({ length: 40000 }, (_, index) => `${index}:x`).join('; ')}; other:y;}}`;
    const tree = { en: { message, plural }, cs: { message, plural } };

    return () => lintCatalogue(tree);
  } },
  { name: 'lintCatalogue: 1 000 messages in two locales', kind: 'time', run: () => {
    const tree = catalogue(1000);

    return () => lintCatalogue(tree);
  } },
  { name: 'lintCatalogue: 10 000 messages in two locales', kind: 'time', run: () => {
    const tree = catalogue(10000);

    return () => lintCatalogue(tree);
  } },
  { name: 'readCatalogue: 10 000 messages of JSON', kind: 'time', run: () => {
    const text = JSON.stringify(catalogue(10000).cs, null, 2);

    return () => readCatalogue(text);
  } },
];
