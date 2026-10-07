import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { lintEntries } from './catalogue';
import type { Entry } from './catalogue';
import { hidden, readPattern, tagOf } from './locale';
import type { Pattern, Placed, Reader, Reading } from './locale';
import { lintMessage } from './message';
import { readCatalogue } from './read';
import type { Located } from './read';
import type { Finding, Severity } from './types';

export const USAGE = `Usage: curly-lint [options] <pattern, file or directory>...

Lints the Curly Message Format messages in JSON catalogues. A pattern names
them, and where their paths hold each file's locale and namespace: in
"locales/{locale}/{namespace}.json", locales/cs/admin/users.json holds cs
messages whose ids sit under admin.users. A file or a directory searched for
.json files names neither. Quote a pattern, as a shell may read its braces.

Options:
  --locale <tag>      The locale of every file whose path holds none.
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
the arguments are wrong, a path cannot be read or a pattern names no file,
and 0 otherwise.`;

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

// What a path given as it is names below it: every .json file, placed nowhere.
const PLAIN: Reader = {
  start: { at: 0, span: [], placed: { namespace: [] } },
  enter: (reading, name) => (hidden(name) ? [] : [reading]),
  place: (reading, name) => (name.endsWith('.json') && !hidden(name) ? reading.placed : undefined),
  key: () => '',
};

// By code units, which neither the runtime nor its locale orders otherwise.
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isDirectory = (path: string) => stat(path).then((found) => found.isDirectory(), () => false);

// Whether a directory is another or holds it, both where they stand.
const holds = (outer: string, inner: string) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`);

type Found = { path: string, real: string, placed: Placed, links: number };

// The files a path names, each with where it stands, what it is read as and
// the links followed to reach it: a file given as it is, or the .json files
// below a directory. A directory is read once for each reading the reader
// keys apart, at the path with the fewest links, so a link only adds to what
// the paths without one read. A link is not followed to a directory that
// holds it, nor to the directory searched or one holding it. Each path reads
// its base afresh, as which links it follows turns on the base.
const catalogues = async (path: string, pattern: Pattern | undefined): Promise<Found[]> => {
  // A file given as it is need stand nowhere, as a pipe does not.
  if (!(await stat(path)).isDirectory()) return pattern ? [] : [{ path, real: await realpath(path).catch(() => path), placed: PLAIN.start.placed, links: 0 }];

  const real = await realpath(path);
  const reader = pattern ?? PLAIN;
  const seen = new Set<string>();
  const files: Found[] = [];
  const linked: [string, string, Reading[], number][] = [];

  const read = async (directory: string, at: string, readings: Reading[], links: number) => {
    const fresh: Reading[] = [];

    for (const reading of readings) {
      const key = `${reader.key(reading)}\0${at}`;

      if (!seen.has(key)) fresh.push(reading);
      seen.add(key);
    }

    if (!fresh.length) return;

    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => byCode(a.name, b.name))) {
      const { name } = entry;
      const link = entry.isSymbolicLink();
      // What the readings take the entry for, asked before a link is
      // followed to learn which it is, as most entries are read as neither.
      const next = entry.isDirectory() || link ? fresh.flatMap((reading) => reader.enter(reading, name)) : [];
      const placings = entry.isFile() || link ? fresh.map((reading) => reader.place(reading, name)) : [];

      if (!next.length && !placings.some(Boolean)) continue;

      const child = join(directory, name);

      if (entry.isDirectory() || (link && await isDirectory(child))) {
        if (!next.length) continue;
        if (link) linked.push([child, at, next, links + 1]);
        else await read(child, join(at, name), next, links);
      } else if (placings.some(Boolean)) {
        const target = link ? await realpath(child).catch(() => join(at, name)) : join(at, name);

        for (const placed of placings) if (placed) files.push({ path: child, real: target, placed, links: link ? links + 1 : links });
      }
    }
  };

  await read(path, real, [reader.start], 0);

  for (let index = 0; index < linked.length; index += 1) {
    const [child, holder, readings, links] = linked[index];
    const target = await realpath(child);

    if (!holds(target, holder) && !holds(target, real)) await read(child, target, readings, links);
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

  for (const [option, value] of [['--locale', values.locale], ['--source', values.source]]) {
    if (value !== undefined && !tagOf(value)) {
      io.err(`${option} ${JSON.stringify(value)} is no locale: expected a tag such as cs or en-US.\n`);

      return 2;
    }
  }

  const given = values.locale === undefined ? undefined : tagOf(values.locale);
  const source = values.source === undefined ? undefined : tagOf(values.source);
  const patterns = new Map<string, Pattern>();

  for (const argument of positionals) {
    if (!/[{}]/.test(argument)) continue;

    const pattern = readPattern(argument);

    if (!pattern.ok) {
      io.err(`The pattern ${argument} ${pattern.message}\n`);

      return 2;
    }

    patterns.set(argument, pattern);
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

  // The files to read, in the order of the arguments and of the paths each
  // reaches, with where each stands and what a pattern places in it, which a
  // path given as it is does not.
  const files: { path: string, real: string, placed?: Placed }[] = [];
  // Each file a pattern reads by where it stands and the locale it is read
  // in, and each a path given as it is reads by where it stands.
  const placedAt = new Set<string>();
  const plainAt = new Set<string>();
  // Where the files a pattern reads stand.
  const patterned = new Set<string>();
  let unplaced = 0;

  for (const argument of positionals) {
    const pattern = patterns.get(argument);

    try {
      const found = await catalogues(resolve(io.cwd, pattern ? pattern.base : argument), pattern);

      if (pattern && !found.length) {
        io.err(`No .json file matches the pattern ${argument}.\n`);
        unreadable = true;
      }

      // A pattern reads a file once for each locale, and a directory given as
      // it is reads one once: by the first argument that reaches it, at the
      // path through the fewest links, and of those the first in the order of
      // paths.
      const ranked = found.map((file) => ({ file, order: file.path.split(sep).join('\0') })).sort((a, b) => a.file.links - b.file.links || byCode(a.order, b.order));
      const kept: typeof ranked = [];

      for (const { file, order } of ranked) {
        const [at, id] = pattern ? [placedAt, `${file.real}\0${file.placed.locale ?? given ?? ''}`] : [plainAt, file.real];

        if (pattern) patterned.add(file.real);
        if (at.has(id)) continue;
        at.add(id);
        kept.push({ file, order });
      }

      for (const { file: { path, real, placed } } of kept.sort((a, b) => byCode(a.order, b.order))) files.push({ path, real, placed: pattern && placed });
    } catch (error) {
      io.err(`Cannot read ${argument}: ${(error as Error).message}\n`);
      unreadable = true;
    }
  }

  for (const { path, real, placed } of files) {
    // A file a pattern reads is read as the pattern places it, whichever path
    // given as it is reaches it too.
    if (!placed && patterned.has(real)) continue;

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
    const locale = placed?.locale ?? given;
    const namespace = placed?.namespace ?? [];

    if (locale) locales.add(locale);
    else unplaced += 1;

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

  if (unplaced) {
    const [count, their] = unplaced === 1 ? ['1 file has', 'its'] : [`${unplaced} files have`, 'their'];

    io.err(`${count} no locale, so ${their} messages are linted without one, and compared with no other locale's. Name it in a pattern, as in curly-lint "locales/{locale}/{namespace}.json".\n`);
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
