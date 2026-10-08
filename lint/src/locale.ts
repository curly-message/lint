/** What a pattern reads off a path: the locale and the namespace. */
export type Placed = { locale?: string, namespace: string[] };

/**
 * How far a walk down a path has read it: the name of the pattern it reads
 * next, the names the namespace spans so far where it goes on past them, and
 * what the names before placed.
 */
export type Reading = { at: number, span: string[], placed: Placed };

/** What a walk reads a path with, name by name. */
export type Reader = {
  start: Reading,
  /** The readings a directory gives, none where nothing below it is read. */
  enter: (reading: Reading, name: string) => Reading[],
  /** The locale and namespace a file is read under, where it is read. */
  place: (reading: Reading, name: string) => Placed | undefined,
  /**
   * One text for the readings that read the same files below a directory, in
   * the same locale, though under namespaces that may differ.
   */
  key: (reading: Reading) => string,
};

export type Pattern = Reader & {
  /** The directory before the first placeholder, written with `/`. */
  base: string,
  /** Whether a path the pattern reads places the locale of its files. */
  locates: boolean,
};

const LOCALE = '{locale}';
const NAMESPACE = '{namespace}';
const SEPARATOR = /[\\/]/;

/**
 * A locale tag as a path or an option writes it, with `-` for `_`, where it
 * is one whose language has two or three letters. One of five to eight is
 * well-formed, but none is registered, and the words a project names its
 * files with — `common`, `package` — are such.
 */
export const tagOf = (text: string): string | undefined => {
  const tag = text.replace(/_/g, '-');
  const end = tag.indexOf('-');
  const language = end === -1 ? tag.length : end;

  if (language < 2 || language > 3) return undefined;

  try {
    Intl.getCanonicalLocales(tag);

    return tag;
  } catch {
    return undefined;
  }
};

/**
 * A name no placeholder reads, and no directory given as it is: a hidden one,
 * or a package's dependencies.
 */
export const hidden = (name: string) => name.startsWith('.') || name === 'node_modules';

// A name of a pattern: its text before, between and after the placeholders
// it holds.
type Name = { before: string, first?: string, between: string, second?: string, after: string };

const nameOf = (text: string): Name => {
  const [one, two] = [LOCALE, NAMESPACE].map((placeholder) => ({ placeholder, at: text.indexOf(placeholder) })).filter(({ at }) => at !== -1).sort((a, b) => a.at - b.at);

  if (!one) return { before: text, between: '', after: '' };
  if (!two) return { before: text.slice(0, one.at), first: one.placeholder, between: '', after: text.slice(one.at + one.placeholder.length) };

  return {
    before: text.slice(0, one.at),
    first: one.placeholder,
    between: text.slice(one.at + one.placeholder.length, two.at),
    second: two.placeholder,
    after: text.slice(two.at + two.placeholder.length),
  };
};

// What a name of a pattern reads off the text a path holds there. Where the
// namespace goes on past the text, `open`, the text holds none of what the
// name writes after the namespace.
const placedOf = (name: Name, text: string, open = false): Placed | undefined => {
  if (!name.first) return text === name.before ? { namespace: [] } : undefined;

  const after = open ? '' : name.after;
  const second = open && name.first === NAMESPACE ? undefined : name.second;

  if (!text.startsWith(name.before) || !text.endsWith(after)) return undefined;

  const inner = text.slice(name.before.length, text.length - after.length);
  // No tag holds the text between two placeholders, so the locale ends
  // where that text stands nearest it.
  const at = !second ? inner.length : name.first === LOCALE ? inner.indexOf(name.between) : inner.lastIndexOf(name.between);

  if (at === -1) return undefined;

  const values = new Map([[name.first, inner.slice(0, at)], [second, inner.slice(at + name.between.length)]]);
  const written = values.get(LOCALE);
  const locale = written === undefined ? undefined : tagOf(written);
  const namespace = values.get(NAMESPACE)?.split('/') ?? [];

  if ((written !== undefined && !locale) || namespace.includes('')) return undefined;

  return { ...(locale ? { locale } : {}), namespace };
};

// Whether a name of a pattern reads the text a path holds there. A hidden
// name or node_modules is read only where the pattern writes it: as a name
// of its own, or by the text before a placeholder, `.{locale}.json`. A name
// the namespace goes on to past its first is the placeholder's alone.
const readable = (name: Name, text: string, first: boolean) => !name.first || !hidden(text) || (first && name.before.startsWith('.'));

// What a path places, with what one more name of it places: the locale,
// which one name holds, and the namespace, which goes on name after name.
const merge = (placed: Placed, found: Placed): Placed => ({ ...placed, ...found, namespace: [...placed.namespace, ...found.namespace] });

/**
 * Reads a pattern such as `locales/{locale}/{namespace}.json`: `{locale}`
 * stands for a locale tag within one name, and `{namespace}` for one name or
 * more, the namespace the ids of a file sit under. Each is there once at
 * most, and both share a name only where a text no tag holds parts them.
 */
export const readPattern = (pattern: string): ({ ok: true } & Pattern) | { ok: false, message: string } => {
  const fail = (message: string) => ({ ok: false as const, message });

  for (let at = 0; at < pattern.length; at += 1) {
    if (pattern[at] !== '{' && pattern[at] !== '}') continue;

    const placeholder = [LOCALE, NAMESPACE].find((name) => pattern.startsWith(name, at));

    if (!placeholder) return fail('holds a brace that opens neither {locale} nor {namespace}.');
    if (pattern.includes(placeholder, at + placeholder.length)) return fail(`holds ${placeholder} twice.`);

    at += placeholder.length - 1;
  }

  const first = [LOCALE, NAMESPACE].map((placeholder) => pattern.indexOf(placeholder)).filter((at) => at !== -1).sort((a, b) => a - b)[0];

  if (first === undefined) return fail('holds neither {locale} nor {namespace}.');

  const split = Math.max(pattern.lastIndexOf('/', first), pattern.lastIndexOf('\\', first)) + 1;
  const texts = pattern.slice(split).split(SEPARATOR);

  if (texts.some((text) => text === '' || text === '.' || text === '..')) return fail('holds an empty name, `.` or `..` after its first placeholder.');
  if (!texts[texts.length - 1].endsWith('.json')) return fail('names no .json file: end it with .json, as in locales/{locale}/{namespace}.json.');

  const names = texts.map(nameOf);

  if (names.some(({ second, between }) => second && !/[^A-Za-z0-9_-]/.test(between))) return fail('parts {locale} and {namespace} with nothing a locale cannot hold, such as `.`.');

  const last = names.length - 1;
  const spanning = names.findIndex(({ first: one, second }) => one === NAMESPACE || second === NAMESPACE);

  return {
    ok: true,
    base: pattern.slice(0, split).replace(/\\/g, '/') || '.',
    locates: pattern.includes(LOCALE),
    start: { at: 0, span: [], placed: { namespace: [] } },
    enter: ({ at, span, placed }, name) => {
      if (at !== spanning) {
        const found = at < last && readable(names[at], name, true) ? placedOf(names[at], name) : undefined;

        return found ? [{ at: at + 1, span, placed: merge(placed, found) }] : [];
      }

      // The namespace goes on past the name, or ends at it. Its first name
      // is read as it opens, and a locale written there placed, so what a
      // directory below holds turns on no name but the last.
      if (!readable(names[at], name, !span.length)) return [];

      const opened = span.length ? placed : placedOf(names[at], name, true);
      const ended = at < last ? placedOf(names[at], [...span, name].join('/')) : undefined;

      return [
        ...(opened ? [{ at, span: [...span, name], placed: merge(placed, { ...opened, namespace: [] }) }] : []),
        ...(ended ? [{ at: at + 1, span: [], placed: merge(placed, ended) }] : []),
      ];
    },
    place: ({ at, span, placed }, name) => {
      const found = at === last && readable(names[at], name, at !== spanning || !span.length) ? placedOf(names[at], [...span, name].join('/')) : undefined;

      return found && merge(placed, found);
    },
    key: ({ at, span, placed }) => `${at}${span.length ? '+' : ''} ${placed.locale ?? ''}`,
  };
};
