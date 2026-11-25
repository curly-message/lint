import { failure, fromHost, readText } from './core';
import type { Finding } from './types';

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
  | { ok: true, strings: Located[], replaced: Replaced[] }
  | { ok: false, message: string, offset: number };

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

const HIGH = /[\ud800-\udbff]/;

// The core counts a character an escape sequence spells, and a file spells
// one outside the Basic Multilingual Plane with two sequences, a code unit
// each.
const located = (value: string, start: number, spelled: [number, number][]) => {
  const escapes: number[] = [];
  const extra: number[] = [];
  let sum = 0;

  for (const [unit, written] of spelled) {
    const units = HIGH.test(value.charAt(unit)) ? 2 : 1;

    for (let part = 0; part < units; part += 1) {
      sum += written / units - 1;
      escapes.push(unit + part);
      extra.push(sum);
    }
  }

  return locator(start, value.length, escapes, extra);
};

const findings = new WeakMap<Read, Finding[]>();

/**
 * Reads a JSON catalogue the way `JSON.parse` does — a later member of the
 * same name replaces an earlier one — past a byte order mark, and says where
 * each string stands, so a finding in a message can be pointed at in the
 * file. A catalogue nested deeper than 512 levels is not read. The text is
 * read as UTF-8 holds it, so a surrogate written as itself that pairs with
 * no other reads as U+FFFD.
 */
export const readCatalogue = (text: string): Read => {
  try {
    const given = fromHost(() => {
      if (typeof text !== 'string' && !((text as unknown) instanceof String)) throw new TypeError(`readCatalogue reads a string, not ${text === null ? 'null' : typeof text}`);

      return String(text);
    });
    const { findings: found, read: answered } = readText(given);
    const read: Read = answered.ok
      ? { ok: true, strings: answered.strings.map(({ escapes, ...string }) => ({ ...string, offsetOf: located(string.value, string.start, escapes) })), replaced: answered.replaced }
      : answered;

    findings.set(read, found);

    return read;
  } catch (error) {
    throw failure(error);
  }
};

/**
 * The findings reading a catalogue file yielded, located by UTF-16 code
 * units of its text: where the file stops being readable, or each member a
 * later one of the same name replaces.
 */
export const readFindings = (read: Read): Finding[] => findings.get(read) ?? [];
