// The rows `../bench/harness.mjs` measures, each on the build in `dist/`.
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { lintCatalogue, lintMessage, readCatalogue } from '../dist/index.js';

const bundle = () => Buffer.concat(readdirSync(new URL('../dist/', import.meta.url)).filter((name) => name.endsWith('.js')).sort().map((name) => readFileSync(new URL(`../dist/${name}`, import.meta.url))));

// What `import '@curly-message/lint'` loads: the library's entry and the
// chunks it imports, and those they import, each once.
const library = () => {
  const loaded = new Map();
  const load = (name) => {
    if (loaded.has(name)) return;

    const text = readFileSync(new URL(`../dist/${name}`, import.meta.url));

    loaded.set(name, text);
    for (const [, imported] of text.toString('utf8').matchAll(/(?:from|import)\s*["']\.\/([^"']+)["']/g)) load(imported);
  };

  load('index.js');

  return Buffer.concat([...loaded.values()]);
};

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

// What the command asks of the file system walking a tree of catalogues:
// three locales of three namespaces of three files, a directory beside them
// that is no locale, and the links a project makes, each of which a walk
// could follow more often than it needs. A locale that is another's, a
// namespace that is another's, a link to a directory above, a locale linked
// in from elsewhere that links back to the directory searched, a chain of
// directories each linked twice from the one before, which has 2^8 paths to
// its end, and links to the chain from hidden names and node_modules, which
// a walk need not follow.
const walked = (...argv) => {
  const root = mkdtempSync(join(tmpdir(), 'curly-lint-bench-'));
  const file = (path) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), '{"hi": "Hi"}');
  };
  const link = (target, path) => symlinkSync(join(root, target), join(root, path), 'junction');

  try {
    for (const locale of ['en', 'cs', 'de']) {
      for (const namespace of ['a', 'b', 'c']) for (const name of ['x', 'y', 'z']) file(`locales/${locale}/${namespace}/${name}.json`);
      file(`locales/${locale}/.git/x.json`);
    }

    file('locales/tools/a/x.json');
    link('locales/en', 'locales/pt');
    link('locales/en/a', 'locales/en/d');
    link('.', 'locales/cs/up');
    file('vendor/fr/a/x.json');
    link('vendor/fr', 'locales/fr');
    link('locales', 'vendor/fr/back');
    file('chain/8/x.json');
    for (let step = 0; step < 8; step += 1) {
      mkdirSync(join(root, `chain/${step}`), { recursive: true });
      link(`chain/${step + 1}`, `chain/${step}/l`);
      link(`chain/${step + 1}`, `chain/${step}/r`);
    }

    link('chain/0', 'locales/de/chain');
    for (const locale of ['en', 'cs', 'de']) {
      link('chain', `locales/${locale}/.cache`);
      link('chain', `locales/${locale}/a/node_modules`);
    }

    // `--import` takes a URL, which a path on Windows is not.
    const { status, stderr, output } = spawnSync(process.execPath, ['--import', new URL('count-fs.mjs', import.meta.url).href, fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ...argv], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    const count = Number(output[3]);

    if (status !== 0) throw new Error(`the command exited ${status}: ${stderr}`);
    if (!(count > 0)) throw new Error('the command counted no call');

    return count;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

// The command writing a report of 20 000 findings to a regular file, as a CI
// job that keeps it does: a catalogue of 20 000 messages, each opening a
// placeholder nothing closes.
const reported = () => {
  const root = mkdtempSync(join(tmpdir(), 'curly-lint-bench-'));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  let size;

  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'en.json'), JSON.stringify(Object.fromEntries(Array.from({ length: 20000 }, (_, index) => [`m${index}`, '{{']))));

  return () => {
    const fd = openSync(join(root, 'report.txt'), 'w');

    try {
      const { status, stderr } = spawnSync(process.execPath, [cli, 'en.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', fd, 'pipe'] });
      const written = fstatSync(fd).size;

      if (status !== 1) throw new Error(`the command exited ${status}: ${stderr}`);
      if (written < 20000 || (size ?? written) !== written) throw new Error(`the command wrote ${written} bytes`);

      size = written;
    } finally {
      closeSync(fd);
    }
  };
};

// The command over a catalogue of 5 000 messages in each of two locales,
// beside a file of a third locale that is not JSON. What that file holds is
// unknown, so no message under its namespace, which holds every one, is
// compared.
const uncompared = () => {
  const root = mkdtempSync(join(tmpdir(), 'curly-lint-bench-'));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

  process.once('exit', () => rmSync(root, { recursive: true, force: true }));
  for (const [locale, tree] of Object.entries({ ...catalogue(5000), de: undefined })) {
    mkdirSync(join(root, locale));
    writeFileSync(join(root, locale, 'common.json'), tree ? JSON.stringify(tree) : '{"hi":');
  }

  return () => {
    const { status, stderr } = spawnSync(process.execPath, [cli, '{locale}/{namespace}.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });

    if (status !== 1) throw new Error(`the command exited ${status}: ${stderr}`);
  };
};

export default [
  { name: 'dist/*.js', kind: 'size', run: () => bundle().length },
  { name: 'dist/*.js, gzipped', kind: 'size', run: () => gzipSync(bundle(), { level: 9 }).length },
  { name: 'dist/index.js and the chunks it imports', kind: 'size', run: () => library().length },
  { name: 'catalogue reads: linting 1 000 messages in two locales', kind: 'count', run: reads },
  { name: 'curly-lint: file system calls, a pattern over a tree with links', kind: 'count', run: () => walked('locales/{locale}/{namespace}.json') },
  { name: 'curly-lint: file system calls, a directory given as it is, over the same tree', kind: 'count', run: () => walked('.') },
  { name: 'curly-lint: a report of 20 000 findings, written to a regular file', kind: 'time', run: reported },
  { name: 'curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON', kind: 'time', run: uncompared },
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
