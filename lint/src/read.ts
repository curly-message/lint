/** A string a catalogue file holds, where it stands in the file. */
export type Located = {
  /** The path to the string: member names and array indices. */
  path: string[],
  value: string,
  /** Where the string's opening quote and closing quote stand in the file. */
  start: number,
  end: number,
  /**
   * Where the code unit at `index` of the value is written in the file, past
   * any escape sequence the file spells it with; `value.length` answers the
   * closing quote.
   */
  offsetOf: (index: number) => number,
};

/** A member a later one of the same name replaces, so its value is never read. */
export type Replaced = { path: string[], start: number, end: number };

export type Read =
  | { ok: true, value: unknown, strings: Located[], replaced: Replaced[] }
  | { ok: false, message: string, offset: number };

// How deep a catalogue's objects and arrays may nest: the reader descends by
// calls, which a call stack holds only so many of.
const MAX_DEPTH = 512;

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

// A character as a report shows it: by its code point where it is invisible,
// or would break the line the report is on.
const shown = (char: string) => (/[\p{C}\p{Z}]/u.test(char) ? `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : `\`${char}\``);

// Where the code unit at `index` of a string's value is written: past the
// opening quote, and past the units each escape sequence before it is
// written with beyond the one it reads as. `escapes` holds the unit each
// sequence reads as, and `extra` those units, summed up to each.
const locator = (start: number, length: number, escapes: number[], extra: number[]) => (index: number) => {
  const unit = Math.max(0, Math.min(index, length));
  let low = 0;
  let high = escapes.length;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (escapes[middle] < unit) low = middle + 1;
    else high = middle;
  }

  return start + 1 + unit + (low ? extra[low - 1] : 0);
};

// The strings no dropped range covers.
const kept = (strings: Located[], dropped: [number, number][]) => {
  const covered = new Int32Array(strings.length + 1);

  for (const [from, to] of dropped) {
    covered[from] += 1;
    covered[to] -= 1;
  }

  let depth = 0;

  return strings.filter((_, index) => {
    depth += covered[index];

    return !depth;
  });
};

class Unreadable extends Error {
  constructor(message: string, readonly offset: number) {
    super(message);
  }
}

/**
 * Reads a JSON catalogue the way `JSON.parse` does — a later member of the
 * same name replaces an earlier one — past a byte order mark, and says where
 * each string stands, so a finding in a message can be pointed at in the
 * file. A catalogue nested deeper than 512 levels is not read.
 */
export const readCatalogue = (text: string): Read => {
  const strings: Located[] = [];
  // The ranges of `strings` a later member of the same name replaced.
  const dropped: [number, number][] = [];
  const replaced: Replaced[] = [];
  let at = 0;

  const fail = (what: string): never => {
    throw new Unreadable(at < text.length ? `${what}, found ${shown(String.fromCodePoint(text.codePointAt(at)!))}` : `${what}, found the end of the file`, at);
  };

  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at])) at += 1;
  };

  const string = () => {
    const start = at;
    const escapes: number[] = [];
    const extra: number[] = [];
    let value = '';

    if (text[at] !== '"') fail('Expected a string');
    at += 1;

    while (text[at] !== '"') {
      if (at >= text.length) fail('Expected the string to close');

      const char = text[at];

      if (char < ' ') fail('Expected a control character to be escaped');

      if (char !== '\\') {
        value += char;
        at += 1;
        continue;
      }

      const kind = text[at + 1];
      let width = 2;

      if (kind === 'u') {
        const hex = text.slice(at + 2, at + 6);

        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Expected four hexadecimal digits');
        value += String.fromCharCode(parseInt(hex, 16));
        width = 6;
      } else if (kind !== undefined && kind in ESCAPES) {
        value += ESCAPES[kind];
      } else {
        at += 1;
        fail('Expected an escape sequence');
      }

      escapes.push(value.length - 1);
      extra.push((extra.at(-1) ?? 0) + width - 1);
      at += width;
    }

    at += 1;

    return { value, start, end: at, offsetOf: locator(start, value.length, escapes, extra) };
  };

  const value = (path: string[]): unknown => {
    space();

    const char = text[at];

    if ((char === '{' || char === '[') && path.length >= MAX_DEPTH) throw new Unreadable(`The catalogue nests deeper than ${MAX_DEPTH} levels`, at);
    if (char === '{') return object(path);
    if (char === '[') return array(path);

    if (char === '"') {
      const { value: read, start, end, offsetOf } = string();

      strings.push({ path, value: read, start, end, offsetOf });

      return read;
    }

    for (const [word, meant] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, at)) {
        at += word.length;

        return meant;
      }
    }

    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

    number.lastIndex = at;

    const found = number.exec(text);

    if (!found) fail('Expected a value');
    at += found![0].length;

    return Number(found![0]);
  };

  const object = (path: string[]) => {
    // A null prototype takes `__proto__` as a member like any other, as
    // `JSON.parse` does.
    const out = Object.create(null) as Record<string, unknown>;
    const keys = new Map<string, { start: number, end: number, from: number, to: number }>();

    at += 1;
    space();

    if (text[at] === '}') {
      at += 1;

      return out;
    }

    for (;;) {
      space();

      const key = string();

      space();
      if (text[at] !== ':') fail('Expected a colon');
      at += 1;

      const earlier = keys.get(key.value);

      if (earlier) {
        replaced.push({ path: [...path, key.value], start: earlier.start, end: earlier.end });
        // What the earlier member held is no longer in the catalogue.
        dropped.push([earlier.from, earlier.to]);
      }

      const from = strings.length;

      out[key.value] = value([...path, key.value]);
      keys.set(key.value, { start: key.start, end: key.end, from, to: strings.length });
      space();

      if (text[at] === ',') {
        at += 1;
        continue;
      }

      if (text[at] === '}') {
        at += 1;

        return out;
      }

      fail('Expected a comma or a closing brace');
    }
  };

  const array = (path: string[]) => {
    const out: unknown[] = [];

    at += 1;
    space();

    if (text[at] === ']') {
      at += 1;

      return out;
    }

    for (;;) {
      out.push(value([...path, `${out.length}`]));
      space();

      if (text[at] === ',') {
        at += 1;
        continue;
      }

      if (text[at] === ']') {
        at += 1;

        return out;
      }

      fail('Expected a comma or a closing bracket');
    }
  };

  try {
    // A byte order mark is no part of the document.
    if (text.charCodeAt(0) === 0xfeff) at = 1;

    const read = value([]);

    space();
    if (at < text.length) fail('Expected the end of the file');

    return { ok: true, value: read, strings: kept(strings, dropped), replaced };
  } catch (error) {
    if (error instanceof Unreadable) return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
};
