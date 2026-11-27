// The rows `bench/harness.mjs` measures, each on what `bench/prepare.sh`
// writes: in `bench/dist/`, the wheel and the sdist, which the size rows
// weigh; in `bench/.venv/`, the wheel installed, whose `curly-lint` the
// command's rows start, as a project that installs the package runs it.
import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('dist/', import.meta.url));
const cli = fileURLToPath(new URL('.venv/bin/curly-lint', import.meta.url));

// The harness heads its table with a package's name and version; a Python
// package has no package.json to read them from.
const project = readFileSync(new URL('../pyproject.toml', import.meta.url), 'utf8').match(/^\[project\]\n(?:[^[\n].*\n)*/m)[0];

export const name = project.match(/^name = "([^"]+)"$/m)[1];
export const version = project.match(/^version = "([^"]+)"$/m)[1];

// The one file of `bench/dist/` that ends so.
const built = (ending) => {
  const files = readdirSync(dist).filter((file) => file.endsWith(ending));

  if (files.length !== 1) throw new Error(`bench/dist/ holds ${files.length} files ending in ${ending}, not one`);

  return join(dist, files[0]);
};

// The files a wheel holds, read off its central directory: a zip ends with a
// record that counts them, which no comment follows in a wheel.
const entries = (file) => {
  const bytes = readFileSync(file);
  const end = bytes.length - 22;

  if (bytes.readUInt32LE(end) !== 0x06054b50) throw new Error(`${file} does not end as a zip with no comment does`);

  return bytes.readUInt16LE(end + 10);
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

export default [
  { name: 'the wheel', kind: 'size', run: () => statSync(built('.whl')).size },
  { name: 'the sdist', kind: 'size', run: () => statSync(built('.tar.gz')).size },
  { name: 'curly-lint: the command, installed', kind: 'size', run: () => statSync(cli).size },
  { name: 'files in the wheel', kind: 'count', run: () => entries(built('.whl')) },
  { name: 'curly-lint: a report of 20 000 findings, written to a regular file', kind: 'time', run: reported },
  { name: 'curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON', kind: 'time', run: uncompared },
];
