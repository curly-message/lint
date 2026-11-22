import { describe, expect, it } from 'vitest';
import { entriesOf, flatten, lintCatalogue, lintEntries, lintMessage } from '@curly-message/lint';

const codes = (found: ReturnType<typeof lintCatalogue>) => found.map(({ code, locale, id }) => `${code} ${locale} ${id}`);

describe('flatten', () => {
  it('lists every string leaf by its dotted path, in order, and nothing else', () => {
    expect(flatten({ a: 'A', b: { c: 'C', d: 1, e: null }, f: ['F0', { g: 'G' }] })).toEqual([
      { id: 'a', message: 'A' },
      { id: 'b.c', message: 'C' },
      { id: 'f.0', message: 'F0' },
      { id: 'f.1.g', message: 'G' },
    ]);
  });

  it('lists both of two paths that join to one id', () => {
    expect(flatten({ 'a.b': 'X', a: { b: 'Y' } }).map(({ id }) => id)).toEqual(['a.b', 'a.b']);
  });

  it('reads a member named `__proto__` as a member', () => {
    expect(flatten(JSON.parse('{"__proto__": "P"}'))).toEqual([{ id: '__proto__', message: 'P' }]);
  });

  it('reads a tree nested deeper than a call stack goes', () => {
    let tree: unknown = 'deep';

    for (let depth = 0; depth < 20000; depth += 1) tree = { a: tree };

    expect(flatten(tree)).toHaveLength(1);
  });

  it('reads an object a tree holds inside itself once, where it is first reached', () => {
    const tree: Record<string, unknown> = { a: 'A', b: { c: 'C' } };

    (tree.b as Record<string, unknown>).up = tree;
    tree.self = tree;

    expect(flatten(tree)).toEqual([{ id: 'a', message: 'A' }, { id: 'b.c', message: 'C' }]);
  });

  it('reads an object a tree holds in several places in each', () => {
    const common = { ok: 'OK' };

    expect(flatten({ a: common, b: common })).toEqual([{ id: 'a.ok', message: 'OK' }, { id: 'b.ok', message: 'OK' }]);

    let empty: unknown = {};

    for (let depth = 0; depth < 64; depth += 1) empty = { a: empty, b: empty };

    expect(flatten(empty)).toEqual([]);
  });

  it('reads no accessor, and calls nothing a tree holds', () => {
    let called = false;
    const tree = {
      get a() {
        called = true;

        return 'A';
      },
      b: 'B',
    };

    expect(flatten(tree)).toEqual([{ id: 'b', message: 'B' }]);
    expect(called).toBe(false);
    expect(flatten(new Proxy({}, { ownKeys: () => { throw new Error('keys'); } }))).toEqual([]);
  });
});

// What a catalogue, read as a list of entries, is found with is pinned by the
// fixture set at the repository's root, `fixtures/entries/`. What stays here is
// what data does not pin: a catalogue as an object of the host, an option of
// another type than it declares, and a catalogue no fixture holds.
describe('a catalogue', () => {
  it('reads a source that is no string as none named, and a locale that is none as its own', () => {
    const catalogue = { en: { hi: 'Hi {{x}}' }, cs: { hi: 'A' } };
    const named = codes(lintCatalogue(catalogue));

    expect(named).toEqual(['parameter-mismatch cs hi']);

    for (const source of [42, ['en'], null]) expect(codes(lintCatalogue(catalogue, { source: source as never }))).toEqual(named);

    expect(codes(lintEntries([{ id: 'hi', message: 'Hi {{x}}' } as never, { locale: 'cs', id: 'hi', message: 'A' }]))).toEqual(['parameter-mismatch cs hi']);
  });

  it('compares a message nested deeper than any call stack goes by the levels resolution reaches', () => {
    const deep = `${'{{v; a:'.repeat(100_000)}x${'}}'.repeat(100_000)}`;

    // `cs` never reads `v`, which `en` reads at every level, and reads `w`.
    expect(codes(lintCatalogue({ en: { m: deep }, cs: { m: '{{w}}' } }))).toEqual(['nesting-limit en m', 'parameter-mismatch cs m', 'parameter-mismatch cs m']);
  });

  it('reads no accessor of a catalogue', () => {
    const catalogue = {
      get de(): unknown {
        throw new Error('de');
      },
      en: {
        get a(): string {
          throw new Error('a');
        },
      },
    };

    expect(lintCatalogue(catalogue)).toEqual([]);
  });

  // A million messages take seconds to lint. `en` holds `b.b...b` past where
  // it is read, and what `cs` lacks of it is unknown: no locale is compared
  // with another.
  it('unreadable-catalogue: a tree past a million messages, read no further and compared with no other locale', { timeout: 30_000 }, () => {
    let doubled: unknown = 'm';

    for (let depth = 0; depth < 21; depth += 1) doubled = { a: doubled, b: doubled };

    const found = lintCatalogue({ en: doubled, cs: { [Array.from({ length: 21 }, () => 'b').join('.')]: 'm', open: '{{' } });

    expect(found).toMatchObject([{ code: 'unreadable-catalogue', locale: 'en', entry: 999999, start: 0, end: 0 }, { code: 'unclosed-placeholder', locale: 'cs', id: 'open' }]);
    expect(found[0].message).toContain('1000000');
  });

  it('unreadable-catalogue: an entry that is not well-formed Unicode text, read no further', () => {
    // `cs` reads no `x`, which no finding says: what the catalogue holds past
    // where its reading stops is unknown, so no locale is compared with
    // another, as `curly-lint` compares nothing a file that is not JSON holds.
    const before = [{ locale: 'en', id: 'a', message: 'Hi {{x}} {{x:zz}}' }, { locale: 'cs', id: 'a', message: 'A' }];
    const after = { locale: 'en', id: 'b', message: '{{v:zz}}' };
    const stop = (what: string, unit: string) => ({ code: 'unreadable-catalogue', severity: 'error', message: `This entry's ${what} is not well-formed Unicode text: it holds the unpaired surrogate ${unit}, so the catalogue is read no further.`, start: 0, end: 0 });

    for (const [entry, what, unit] of [[{ locale: 'cs', id: 'b', message: '{{\ud800' }, 'message', 'U+D800'], [{ locale: 'cs', id: 'b\udc00', message: '{{' }, 'id', 'U+DC00'], [{ locale: '\ud83d', id: 'b', message: '{{' }, 'locale', 'U+D83D']] as const) {
      expect(lintEntries([...before, entry, after], { source: 'en' })).toEqual([
        ...lintMessage(before[0].message, { locale: 'en' }).map((found) => ({ ...found, locale: 'en', id: 'a', entry: 0 })),
        { ...stop(what, unit), locale: entry.locale, id: entry.id, entry: 2 },
      ]);
    }

    expect(codes(lintCatalogue({ en: { a: 'A', '\udfff': '{{', b: '{{v:zz}}' } }))).toEqual(['unreadable-catalogue en \udfff']);
    expect(codes(lintCatalogue({ en: { a: 'A', b: '\ud800' }, cs: { a: 'A' } }))).toEqual(['unreadable-catalogue en b']);
    expect(codes(lintCatalogue({ cs: { a: 'A' }, en: { a: 'A\ud800' } }))).toEqual(['unreadable-catalogue en a']);
    expect(codes(lintCatalogue({ en: { a: 'A' }, cs: { b: '\ud800' } }, { source: 'de' }))).toEqual(['unreadable-catalogue cs b']);
    expect(codes(lintEntries([{ locale: 'en', id: 'a', message: 'A' }, { locale: 'en', id: 'b', message: '\ud800' }], { locales: ['en', 'cs', 'EN'] }))).toEqual(['duplicate-locale en a', 'unreadable-catalogue en b']);
    expect(codes(lintEntries([{ locale: 'en', id: 'a', message: 'A' }, { locale: 'en', id: 'a', message: 'B' }, { locale: 'en', id: 'b\udc00', message: '' }]))).toEqual(['duplicate-id en a', 'unreadable-catalogue en b\udc00']);
  });

  // A locale of the catalogue that holds no message is still one of its
  // locales.
  it('missing-message: a locale with no message at all lacks every one', () => {
    expect(codes(lintCatalogue({ en: { hi: 'Hello', bye: 'Bye' }, cs: {} }))).toEqual(['missing-message en hi', 'missing-message en bye']);
  });

  it('compares with a source the catalogue holds with no message as with any other', () => {
    expect(codes(lintCatalogue({ en: {}, cs: { hi: 'Ahoj', bye: 'Nashle' } }))).toEqual(['orphan-message cs hi', 'orphan-message cs bye']);
  });

  it('duplicate-locale: a spelling under which no message is read, on the first message of its locale', () => {
    expect(codes(lintCatalogue({ 'en-US': {}, cs: { hi: 'Ahoj' }, 'en-us': { hi: 'Hi', bye: 'Bye' } }))).toEqual(['duplicate-locale en-us hi', 'missing-message en-us bye']);
  });

  // A caller's options are no catalogue text: an unpaired surrogate in one
  // reads as U+FFFD, as a command's arguments converted lossily do.
  it('reads a source or a locale of `locales` that is not well-formed Unicode text with U+FFFD in place of each unpaired surrogate', () => {
    expect(lintEntries([{ locale: 'en', id: 'a', message: 'A {{x}}' }], { source: 'x\ud800' }).map(({ message }) => message)).toEqual(['The source locale `x\ufffd` is no locale of the catalogue, so nothing `en` holds is compared with it.']);
    expect(lintEntries([{ locale: 'x\ufffd', id: 'a', message: 'A' }, { locale: 'en', id: 'a', message: 'A {{x}}' }], { source: 'x\udc00' }).map(({ code }) => code)).toEqual(['parameter-mismatch']);
    expect(lintEntries([{ locale: 'en', id: 'a', message: 'A' }], { locales: ['\ud800'] }).map(({ message }) => message)).toEqual(['`\ufffd` has no message `a`.']);
  });

  it('holds no unpaired surrogate in the text of a finding about a locale that holds no message', () => {
    expect(lintCatalogue({ en: { a: 'A' }, '\ud800': {} }).filter(({ message }) => /\p{Cs}/u.test(message))).toEqual([]);
  });

  it('names a message by its index in the entries it was read from', () => {
    const entries = entriesOf({ en: { a: 'A', b: '{{v:zz}}' } });

    expect(entries).toEqual([{ locale: 'en', id: 'a', message: 'A' }, { locale: 'en', id: 'b', message: '{{v:zz}}' }]);
    expect(lintEntries(entries).map(({ entry }) => entry)).toEqual([1]);
  });
});
