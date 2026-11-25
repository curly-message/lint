import { describe, expect, it } from 'vitest';
import { readCatalogue } from '@curly-message/lint';
import type { Read } from '@curly-message/lint';

const ok = (read: Read) => {
  if (!read.ok) throw new Error(read.message);

  return read;
};

// What reading a catalogue file yields, its strings, where each stands, and
// its findings, is pinned by the fixture set at the repository's root,
// `fixtures/read/`. What stays here is a file no fixture holds.
describe('readCatalogue', () => {
  it('names each member a later one replaces by its whole path', () => {
    expect(ok(readCatalogue('{"a": {"b": {"c": "1", "c": "2"}}, "c": "3"}')).replaced).toEqual([{ path: ['a', 'b', 'c'], start: 13, end: 16 }]);
  });

  it('reads `__proto__` as a member', () => {
    expect(ok(readCatalogue('{"__proto__": {"x": "y"}}')).strings.map(({ path, value }) => ({ path, value }))).toEqual([{ path: ['__proto__', 'x'], value: 'y' }]);
  });

  it('refuses a catalogue nested deeper than any call stack goes, and never overflows', () => {
    expect(readCatalogue(`{"a": ${'['.repeat(6000)}"x"${']'.repeat(6000)}}`)).toMatchObject({ ok: false, message: 'The catalogue nests deeper than 512 levels' });
  });

  // A fixture states its text as JSON, which no reader of every language
  // takes an unpaired surrogate in. The text is read as UTF-8 holds it, as
  // a file is.
  it('reads an unpaired surrogate written as itself as U+FFFD, and a pair written so as it is', () => {
    const strings = (text: string) => ok(readCatalogue(text)).strings.map(({ path, value, start, end }) => ({ path, value, start, end }));

    expect(strings('{"a": "b", "c": "x\udfff"}')).toEqual([{ path: ['a'], value: 'b', start: 6, end: 9 }, { path: ['c'], value: 'x\ufffd', start: 16, end: 20 }]);
    expect(strings('{"\ud800": "b"}')).toEqual([{ path: ['\ufffd'], value: 'b', start: 6, end: 9 }]);
    expect(strings('{"a": "\ud83d\ude00"}')).toEqual([{ path: ['a'], value: '\ud83d\ude00', start: 6, end: 10 }]);
  });

  it('throws a `TypeError` where it is handed no string, and reads a `String` object as its text', () => {
    for (const text of [5, null, undefined, {}, ['{}'], true]) expect(() => readCatalogue(text as never)).toThrow(TypeError);

    expect(ok(readCatalogue(new String('{"a": "b"}') as never)).strings.map(({ path, value }) => ({ path, value }))).toEqual([{ path: ['a'], value: 'b' }]);
  });

  it('answers where a code unit of a character two escape sequences spell is written', () => {
    const [{ value, offsetOf }] = ok(readCatalogue('{"a": "\\ud83d\\ude00{{"}')).strings;

    expect(value).toBe('\ud83d\ude00{{');
    expect([0, 1, 2, 3, 4].map(offsetOf)).toEqual([7, 13, 19, 20, 21]);
  });
});
