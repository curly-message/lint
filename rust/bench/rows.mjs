// The rows `bench/harness.mjs` measures, each on the build in `bench/dist/`
// that `bench/prepare.sh` writes: `curly-lint`, the command, whose stripped
// binary the size rows weigh and the command's rows start; the `.crate` a
// release ships; and `curly-message-lint-bench`, the release build that names
// the library's rows, counts the counts and runs the times.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = (file) => new URL(`dist/${file}`, import.meta.url);
const program = fileURLToPath(dist('curly-message-lint-bench'));
const cli = fileURLToPath(dist('curly-lint'));

// The harness heads its table with a package's name and version; a crate has
// no package.json to read them from.
export const name = 'curly-message-lint';
export const version = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8').match(/^\[package\]\n(?:[^[\n].*\n)*?version = "([^"]+)"/m)[1];

// The crates a consumer's build compiles for the linter, the linter among
// them, as the lockfile resolves them: what a feature adds to every
// consumer's build.
const crates = (...features) => {
  const tree = execFileSync('cargo', ['tree', '--locked', '--offline', '-p', name, '-e', 'normal', '--prefix', 'none', ...features], { cwd: root, encoding: 'utf8' });

  return new Set(tree.split('\n').filter(Boolean).map((line) => line.replace(/ \(\*\)$/, ''))).size;
};

// A time row's program, set up and waiting: each batch is a byte written to
// it, answered by a line once the batch has run. A program that exits fails
// the batch waiting on it and every one after.
const serve = (row) => {
  const child = spawn(program, ['serve', row], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  let gone;
  const exited = new Promise((settle) => child.once('close', settle));
  const end = (error) => {
    gone ??= error;
    for (const { reject } of waiting.splice(0)) reject(gone);
  };
  const reply = () => (gone ? Promise.reject(gone) : new Promise((resolve, reject) => waiting.push({ resolve, reject })));

  child.stdout.on('data', (chunk) => {
    for (let index = 0; index < chunk.length; index += 1) waiting.shift()?.resolve();
  });
  child.once('error', end);
  child.once('exit', (code, signal) => end(new Error(`curly-message-lint-bench exited with ${signal ?? `code ${code}`}`)));
  // A write to a program that has exited fails here as well; the exit says why.
  child.stdin.on('error', () => {});

  return reply().then(() => ({
    batch: () => {
      const answer = reply();

      child.stdin.write('\n');

      return answer;
    },
    close: () => {
      child.stdin.end();

      return exited;
    },
  }));
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

// A catalogue of `count` messages in one of the two locales, a hundred to a
// namespace.
const catalogue = (count, side) => {
  const locale = {};

  for (let index = 0; index < count; index += 1) {
    const namespace = (locale[`ns${Math.floor(index / 100)}`] ??= {});

    namespace[`m${index}`] = MESSAGES[index % MESSAGES.length][side];
  }

  return locale;
};

// A directory of its own for a row of the command, removed when the process
// measuring the row ends.
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), 'curly-lint-bench-'));

  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));

  return directory;
};

// The command writing a report of 20 000 findings to a regular file, as a CI
// job that keeps it does: a catalogue of 20 000 messages, each opening a
// placeholder nothing closes.
const reported = () => {
  const directory = scratch();
  let size;

  writeFileSync(join(directory, 'en.json'), JSON.stringify(Object.fromEntries(Array.from({ length: 20000 }, (_, index) => [`m${index}`, '{{']))));

  return () => {
    const fd = openSync(join(directory, 'report.txt'), 'w');

    try {
      const { status, stderr } = spawnSync(cli, ['en.json'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', fd, 'pipe'] });
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
  const directory = scratch();

  for (const [locale, tree] of Object.entries({ en: catalogue(5000, 0), cs: catalogue(5000, 1), de: undefined })) {
    mkdirSync(join(directory, locale));
    writeFileSync(join(directory, locale, 'common.json'), tree ? JSON.stringify(tree) : '{"hi":');
  }

  return () => {
    const { status, stderr } = spawnSync(cli, ['{locale}/{namespace}.json'], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });

    if (status !== 1) throw new Error(`the command exited ${status}: ${stderr}`);
  };
};

const listed = execFileSync(program, ['list'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((line) => JSON.parse(line));

// The row this process serves: the harness calls a row's `run` once in each
// process that measures it.
let served;

export default [
  { name: 'curly-message-lint.crate', kind: 'size', run: () => readFileSync(dist('curly-message-lint.crate')).length },
  { name: 'curly-lint: the command, stripped', kind: 'size', run: () => readFileSync(dist('curly-lint')).length },
  { name: 'curly-lint, gzipped', kind: 'size', run: () => gzipSync(readFileSync(dist('curly-lint')), { level: 9 }).length },
  { name: 'crates: the linter\'s dependency tree', kind: 'count', run: () => crates() },
  { name: 'crates: the linter\'s dependency tree without cldr', kind: 'count', run: () => crates('--no-default-features') },
  { name: 'curly-lint: a report of 20 000 findings, written to a regular file', kind: 'time', run: reported },
  { name: 'curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON', kind: 'time', run: uncompared },
  ...listed.map(({ name: row, kind }) => (kind === 'count'
    ? { name: row, kind, run: () => Number(execFileSync(program, ['count', row], { encoding: 'utf8' })) }
    : { name: row, kind, run: async () => {
      served = await serve(row);

      return served.batch;
    }, close: () => served?.close() })),
];
