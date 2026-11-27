// The rows `bench/harness.mjs` measures, each on what `bench/prepare.sh`
// writes into `bench/dist/`: in `proxy/`, the module's zip as a proxy serves
// it, which a size row weighs; in `bin/`, the launcher the go command
// installs from that proxy, which the command's rows start, as a project
// that installs the module runs it. The launcher keeps the command in
// `bench/dist/kept/`, never in the cache of the user measuring it.
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const zip = fileURLToPath(new URL(`dist/proxy/${name}/@v/v${version}.zip`, import.meta.url));
const cli = fileURLToPath(new URL(`dist/bin/curly-lint${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const env = { ...process.env, CURLY_LINT_CACHE_DIR: fileURLToPath(new URL('dist/kept', import.meta.url)) };

// The modules the launcher is built from, the module among them, as the go
// command records them in the program: what a requirement adds to every
// project that installs it.
const modules = () => execFileSync('go', ['version', '-m', cli], { encoding: 'utf8' }).split('\n').filter((line) => /^\t(?:mod|dep)\t/.test(line)).length;

// The launcher over a cache that holds the command already, as every run but
// a version's first finds it: the command is held to the bytes the launcher
// carries, then run.
const kept = () => {
  const start = () => spawnSync(cli, ['--help'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const first = start();

  if (first.status !== 0) throw new Error(`the command exited ${first.status}: ${first.stderr}`);

  return () => {
    const { status, stdout, stderr } = start();

    if (status !== 0 || stdout !== first.stdout) throw new Error(`the command exited ${status}: ${stderr}`);
  };
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
      const { status, stderr } = spawnSync(cli, ['en.json'], { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', fd, 'pipe'] });
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
    const { status, stderr } = spawnSync(cli, ['{locale}/{namespace}.json'], { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });

    if (status !== 1) throw new Error(`the command exited ${status}: ${stderr}`);
  };
};

export default [
  { name: 'the module zip', kind: 'size', run: () => statSync(zip).size },
  { name: 'curly-lint: the launcher, installed', kind: 'size', run: () => statSync(cli).size },
  { name: 'modules the launcher is built from', kind: 'count', run: modules },
  { name: 'curly-lint: --help, the command kept already', kind: 'time', run: kept },
  { name: 'curly-lint: a report of 20 000 findings, written to a regular file', kind: 'time', run: reported },
  { name: 'curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON', kind: 'time', run: uncompared },
];
