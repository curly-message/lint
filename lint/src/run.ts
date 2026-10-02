import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { lintEntries } from './catalogue';
import type { Entry } from './catalogue';
import { localeOf } from './locale';
import { lintMessage } from './message';
import { readCatalogue } from './read';
import type { Located } from './read';
import type { Finding, Severity } from './types';

export const USAGE = `Usage: curly-lint [options] <file or directory>...

Lints the Curly Message Format messages in JSON catalogues. A directory is
searched for .json files. Each file's locale is read off its path: the
directory that holds the file, else the file's own name, else the nearest
directory farther up, whichever first names one. locales/cs/common.json
holds cs messages under the namespace common.

Options:
  --locale <tag>      The locale of every file given, instead of its path's.
  --source <tag>      The locale the others are compared with (default: en,
                      or the first locale found).
  --modifier <name>   A modifier the host registers. Repeat for each.
  --no-intl           The host satisfies Core alone, so number, date, ago,
                      currency, plural and ordinal are unknown modifiers
                      unless --modifier names them.
  --format <format>   text (default) or json.
  --quiet             Report errors only.
  --help              Print this and exit.

Exits 1 where an error is found, a file that is not JSON included, 2 where
the arguments are wrong or a path cannot be read, and 0 otherwise.`;

export type Io = {
  cwd: string,
  out: (text: string) => void,
  err: (text: string) => void,
};

/** One problem, where it stands in a file. */
export type Problem = {
  file: string,
  line: number,
  column: number,
  endLine: number,
  endColumn: number,
  severity: Severity,
  code: string,
  message: string,
  locale?: string,
  id?: string,
};

const SKIPPED = new Set(['node_modules']);

const isDirectory = (path: string) => stat(path).then((found) => found.isDirectory(), () => false);

// The files a path names: itself, or the .json files a directory holds,
// through links, each directory once however many paths reach it.
const catalogues = async (path: string, seen: Set<string>): Promise<string[]> => {
  if (!(await stat(path)).isDirectory()) return [path];

  const real = await realpath(path);

  if (seen.has(real)) return [];
  seen.add(real);

  const files: string[] = [];

  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;

    const child = join(path, entry.name);
    const linked = entry.isSymbolicLink();

    if (entry.isDirectory() || (linked && await isDirectory(child))) files.push(...await catalogues(child, seen));
    else if ((entry.isFile() || linked) && entry.name.endsWith('.json')) files.push(child);
  }

  return files;
};

// Line and column, both from 1, of an offset in a text. A byte order mark
// is no column, as an editor shows the line without it.
const position = (text: string) => {
  const starts = [text.charCodeAt(0) === 0xfeff ? 1 : 0];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) starts.push(index + 1);
  }

  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);

      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }

    return { line: low + 1, column: offset - starts[low] + 1 };
  };
};

// A locale as a tag, written with `-` as a path may write it with `_`, or
// `null` where it is no tag.
const tagOf = (locale: string | undefined) => {
  if (locale === undefined) return undefined;

  const tag = locale.replace(/_/g, '-');

  try {
    Intl.getCanonicalLocales(tag);

    return tag;
  } catch {
    return null;
  }
};

type Source = { file: string, located: Located, at: (offset: number) => { line: number, column: number } };

// Whether an id sits under one of the namespaces: is one, or goes on past
// one at a dot. The empty namespace holds every id.
const under = (namespaces: Set<string>, id: string) => {
  if (namespaces.has('') || namespaces.has(id)) return true;

  for (let dot = id.indexOf('.'); dot !== -1; dot = id.indexOf('.', dot + 1)) {
    if (namespaces.has(id.slice(0, dot))) return true;
  }

  return false;
};

/** Runs the CLI over its arguments and answers with its exit code. */
export const run = async (argv: string[], io: Io): Promise<number> => {
  let parsed;

  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        locale: { type: 'string' },
        source: { type: 'string' },
        modifier: { type: 'string', multiple: true },
        'no-intl': { type: 'boolean', default: false },
        format: { type: 'string', default: 'text' },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${USAGE}\n`);

    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    io.out(`${USAGE}\n`);

    return 0;
  }

  if (values.format !== 'text' && values.format !== 'json') {
    io.err(`Unknown format ${JSON.stringify(values.format)}: expected text or json.\n`);

    return 2;
  }

  if (!positionals.length) {
    io.err(`${USAGE}\n`);

    return 2;
  }

  const given = tagOf(values.locale);
  const source = tagOf(values.source);

  if (given === null || source === null) {
    const [option, value] = given === null ? ['--locale', values.locale] : ['--source', values.source];

    io.err(`${option} ${JSON.stringify(value)} is no locale: expected a tag such as cs or en-US.\n`);

    return 2;
  }

  const modifiers = values.modifier ?? [];
  const intl = !values['no-intl'];
  const problems: Problem[] = [];

  const report = ({ file, located, at }: Source, found: Finding, about: { locale?: string, id: string }) => {
    // A finding about a whole message points at the string that holds it.
    const whole = found.start === 0 && found.end === 0;
    const from = at(whole ? located.start : located.offsetOf(found.start));
    const to = at(whole ? located.end : located.offsetOf(found.end));

    problems.push({ file, line: from.line, column: from.column, endLine: to.line, endColumn: to.column, severity: found.severity, code: found.code, message: found.message, ...about });
  };

  const entries: Entry[] = [];
  const sources: Source[] = [];
  // Every locale a file is written for, one with no message included.
  const locales = new Set<string>();
  // The namespaces of the files that are not JSON. What such a file holds is
  // unknown, so no message under one is compared, in any locale.
  const unknown = new Set<string>();
  let unreadable = false;

  const files = new Set<string>();
  const seen = new Set<string>();

  for (const path of positionals) {
    try {
      for (const file of await catalogues(resolve(io.cwd, path), seen)) files.add(file);
    } catch (error) {
      io.err(`Cannot read ${path}: ${(error as Error).message}\n`);
      unreadable = true;
    }
  }

  for (const path of files) {
    // Written with forward slashes on every platform, as a path in a
    // report is read across them.
    const file = (relative(io.cwd, path) || path).split(sep).join('/');
    let text: string;

    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      io.err(`Cannot read ${file}: ${(error as Error).message}\n`);
      unreadable = true;
      continue;
    }

    const at = position(text);
    const read = readCatalogue(text);
    const inferred = localeOf(file);
    const locale = given ?? inferred.locale;
    const { namespace } = inferred;

    if (locale) locales.add(locale);

    if (!read.ok) {
      const { line, column } = at(read.offset);

      problems.push({ file, line, column, endLine: line, endColumn: column, severity: 'error', code: 'unreadable-catalogue', message: `${read.message}.` });
      if (locale) unknown.add(namespace.join('.'));
      continue;
    }

    for (const { path: key, start, end } of read.replaced) {
      const from = at(start);
      const to = at(end);

      problems.push({ file, line: from.line, column: from.column, endLine: to.line, endColumn: to.column, severity: 'error', code: 'duplicate-id', message: `\`${key.at(-1)}\` is defined again later in this object, so this value is never read.` });
    }

    for (const located of read.strings) {
      const id = [...namespace, ...located.path].join('.');

      if (locale) {
        entries.push({ locale, id, message: located.value });
        sources.push({ file, located, at });
        continue;
      }

      for (const found of lintMessage(located.value, { modifiers, intl })) report({ file, located, at }, found, { id });
    }
  }

  if (source && !locales.has(source)) {
    io.err(`No file given is written for the source locale \`${source}\`.\n`);

    return 2;
  }

  const compared: number[] = [];

  for (const [index, { locale, id, message }] of entries.entries()) {
    if (!under(unknown, id)) compared.push(index);
    else for (const found of lintMessage(message, { modifiers, intl, locale })) report(sources[index], found, { locale, id });
  }

  for (const found of lintEntries(compared.map((index) => entries[index]), { modifiers, intl, source, locales: [...locales] })) {
    report(sources[compared[found.entry]], found, { locale: found.locale, id: found.id });
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const shown = values.quiet ? problems.filter(({ severity }) => severity === 'error') : problems;

  if (values.format === 'json') {
    io.out(`${JSON.stringify(shown, null, 2)}\n`);
  } else {
    for (const { file, line, column, severity, message, code } of shown) io.out(`${file}:${line}:${column}  ${severity}  ${message}  ${code}\n`);

    const errors = shown.filter(({ severity }) => severity === 'error').length;
    const warnings = shown.length - errors;

    if (shown.length) io.out(`\n${shown.length} ${shown.length === 1 ? 'problem' : 'problems'} (${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'})\n`);
  }

  if (unreadable) return 2;

  return problems.some(({ severity }) => severity === 'error') ? 1 : 0;
};
