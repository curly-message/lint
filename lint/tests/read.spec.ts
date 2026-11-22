import { describe, expect, it } from 'vitest';
import { readCatalogue } from '@curly-message/lint';
import type { Read } from '@curly-message/lint';

const ok = (read: Read) => {
  if (!read.ok) throw new Error(read.message);

  return read;
};

// What reading a catalogue file yields — its strings, where each stands, and
// its findings — is pinned by the fixture set at the repository's root,
// `fixtures/read/`. What stays here is the value read, an object of the host,
// and a file no fixture holds.
describe('readCatalogue', () => {
  it('reads what JSON.parse reads', () => {
    for (const text of ['{"a": "A", "b": {"c": [1, true, null, "C"]}, "d": -1.5e2}', '{"a": "first", "b": "kept", "a": {"x": "second"}}']) {
      expect(ok(readCatalogue(text)).value).toEqual(JSON.parse(text));
    }
  });

  it('names each member a later one replaces by its whole path', () => {
    expect(ok(readCatalogue('{"a": {"b": {"c": "1", "c": "2"}}, "c": "3"}')).replaced).toEqual([{ path: ['a', 'b', 'c'], start: 13, end: 16 }]);
  });

  it('reads `__proto__` as a member', () => {
    const read = ok(readCatalogue('{"__proto__": {"x": "y"}}'));

    expect(Object.keys(read.value as object)).toEqual(['__proto__']);
  });

  it('refuses a catalogue nested deeper than any call stack goes, and never overflows', () => {
    expect(readCatalogue(`{"a": ${'['.repeat(6000)}"x"${']'.repeat(6000)}}`)).toMatchObject({ ok: false, message: 'The catalogue nests deeper than 512 levels' });
  });

  // A fixture states its text as JSON, which no reader of every language
  // takes an unpaired surrogate in.
  it('stops at an unpaired surrogate written as itself, and reads a pair written so', () => {
    expect(readCatalogue('{"a": "b", "c": "x\udfff"}')).toEqual({ ok: false, message: 'Expected well-formed Unicode text, found the unpaired surrogate U+DFFF', offset: 18 });
    expect(readCatalogue('{"\ud800": "b"}')).toEqual({ ok: false, message: 'Expected well-formed Unicode text, found the unpaired surrogate U+D800', offset: 2 });
    expect(readCatalogue('{"a": "\ud800"}')).toEqual({ ok: false, message: 'Expected well-formed Unicode text, found the unpaired surrogate U+D800', offset: 7 });
    expect(ok(readCatalogue('{"a": "\ud83d\ude00"}')).strings.map(({ value }) => value)).toEqual(['\ud83d\ude00']);
  });
});
