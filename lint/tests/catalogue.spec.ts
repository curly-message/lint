import { describe, expect, it } from 'vitest';
import { entriesOf, flatten, lintCatalogue, lintEntries } from '@curly-message/lint';

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

describe('a catalogue', () => {
  it('lints each message with its own locale', () => {
    const found = lintCatalogue({ cs: { files: '{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}' } });

    expect(codes(found)).toEqual(['missing-category cs files']);
    expect(found[0].entry).toBe(0);
  });

  it('duplicate-id: an id defined twice in one locale', () => {
    const found = lintCatalogue({ en: { 'a.b': 'X', a: { b: 'Yy' } } });

    expect(codes(found)).toEqual(['duplicate-id en a.b']);
    // About the whole message, so it spans nothing.
    expect(found[0]).toMatchObject({ start: 0, end: 0 });
  });

  it('compares every locale with the source one: `en`, or the first', () => {
    const catalogue = { cs: { a: 'A', only: 'cs' }, en: { a: 'A', only: 'en' }, de: { a: 'A' } };

    expect(codes(lintCatalogue(catalogue))).toEqual(['missing-message en only']);
    expect(codes(lintCatalogue(catalogue, { source: 'cs' }))).toEqual(['missing-message cs only']);
    expect(codes(lintCatalogue({ cs: { a: 'A' }, de: { b: 'B' } }))).toEqual(['missing-message cs a', 'orphan-message de b']);
    expect(codes(lintCatalogue(catalogue, { source: 'fr' }))).toEqual(['missing-source cs a', 'missing-source en a', 'missing-source de a']);
  });

  it('tells locales apart without regard to case, and reads `_` as `-`', () => {
    const catalogue = { 'en-us': { hi: 'Hi', bye: 'Bye' }, cs: { hi: 'Ahoj' } };

    for (const source of ['en-US', 'EN_us', 'en-us']) {
      expect(lintCatalogue(catalogue, { source }).map(({ code, locale, id, message }) => ({ code, locale, id, message }))).toEqual([
        { code: 'missing-message', locale: 'en-us', id: 'bye', message: '`cs` has no message `bye`.' },
      ]);
    }

    expect(lintCatalogue({ cs: { hi: 'Ahoj {{x}}' }, EN: { hi: 'Hi' } }).map(({ code, locale, message }) => `${code} ${locale} ${message}`)).toEqual([
      'parameter-mismatch cs `x` is read here and never in the `EN` message, so a payload written for that message does not carry it.',
    ]);
    expect(codes(lintEntries([{ locale: 'en-US', id: 'hi', message: 'Hi' }], { locales: ['EN-us', 'cs'] }))).toEqual(['duplicate-locale en-US hi', 'missing-message en-US hi']);

    // An alias, or a tag with a region, is another locale.
    expect(codes(lintCatalogue({ iw: { hi: 'Hi {{x}}' }, he: { hi: 'Hi' } }))).toEqual(['parameter-mismatch he hi']);
    expect(codes(lintCatalogue({ en: { hi: 'Hi {{x}}' }, 'en-US': { hi: 'Hi' } }))).toEqual(['parameter-mismatch en-US hi']);
  });

  it('duplicate-locale: a locale written two ways, read as one', () => {
    const cs = { hi: 'Ahoj', bye: 'Nashle' };
    const found = lintCatalogue({ en_US: { hi: 'Hi' }, 'en-US': { bye: 'Bye' }, cs }, { source: 'cs' });

    expect(found.map(({ code, severity, locale, id, message }) => ({ code, severity, locale, id, message }))).toEqual([
      { code: 'duplicate-locale', severity: 'warning', locale: 'en-US', id: 'bye', message: '`en-US` is `en_US` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.' },
    ]);
    expect(codes(lintCatalogue({ 'en-us': { hi: 'Hi' }, 'en-US': { bye: 'Bye' }, cs }, { source: 'cs' }))).toEqual(['duplicate-locale en-US bye']);

    // One tree under two keys is one locale written two ways, and defines no
    // id twice.
    const en = { hi: 'Hi', bye: 'Bye' };

    expect(codes(lintCatalogue({ 'en-US': en, en_US: en, cs }))).toEqual(['duplicate-locale en_US hi']);
  });

  it('duplicate-id: an id defined under two spellings of one locale with different text', () => {
    const found = lintCatalogue({ 'en-us': { hi: 'Hi {{name}}' }, 'en-US': { hi: 'Hi' } });

    expect(found.map(({ code, locale, id, message }) => `${code} ${locale} ${id} ${message}`)).toEqual([
      'duplicate-locale en-US hi `en-US` is `en-us` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.',
      'duplicate-id en-US hi `hi` is also defined in `en-us`, the same locale written another way, so a host that reads the two as one never reads one of the two messages.',
    ]);

    const again = lintEntries([
      { locale: 'en-us', id: 'hi', message: 'a' },
      { locale: 'en-US', id: 'hi', message: 'b' },
      { locale: 'en-US', id: 'hi', message: 'c' },
    ]);

    expect(again.map(({ code, entry, message }) => `${code} ${entry} ${message}`)).toEqual([
      'duplicate-locale 1 `en-US` is `en-us` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.',
      'duplicate-id 1 `hi` is also defined in `en-us`, the same locale written another way, so a host that reads the two as one never reads one of the two messages.',
      'duplicate-id 2 `hi` is defined again in `en-US`, so one of the two messages is never read.',
    ]);

    // Whichever spelling defines the id first.
    const later = (message: string) => lintEntries([
      { locale: 'en-us', id: 'a', message: 'x' },
      { locale: 'en-US', id: 'b', message: 'y' },
      { locale: 'en-us', id: 'b', message },
      { locale: 'en-us', id: 'a', message: 'x' },
    ]).map(({ code, entry, message: text }) => `${code} ${entry} ${text}`);

    expect(later('y')).toEqual([
      'duplicate-locale 1 `en-US` is `en-us` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.',
      'duplicate-id 3 `a` is defined again in `en-us`, so one of the two messages is never read.',
    ]);
    expect(later('z')).toEqual([
      'duplicate-locale 1 `en-US` is `en-us` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.',
      'duplicate-id 2 `b` is also defined in `en-US`, the same locale written another way, so a host that reads the two as one never reads one of the two messages.',
      'duplicate-id 3 `a` is defined again in `en-us`, so one of the two messages is never read.',
    ]);
  });

  it('missing-source: a source locale the catalogue does not hold, once for each other locale', () => {
    const found = lintCatalogue({ en: { hi: 'Hi {{name}}', bye: 'Bye' }, cs: { hi: 'Ahoj', bye: 'Nashle' } }, { source: 'en-GB' });

    expect(found.map(({ code, severity, locale, id, message }) => ({ code, severity, locale, id, message }))).toEqual([
      { code: 'missing-source', severity: 'error', locale: 'en', id: 'hi', message: 'The source locale `en-GB` is no locale of the catalogue, so nothing `en` holds is compared with it.' },
      { code: 'missing-source', severity: 'error', locale: 'cs', id: 'hi', message: 'The source locale `en-GB` is no locale of the catalogue, so nothing `cs` holds is compared with it.' },
    ]);
    expect(lintCatalogue({ en: {}, cs: {} }, { source: 'de' })).toEqual([]);
    expect(lintCatalogue({}, { source: 'de' })).toEqual([]);

    // A source the catalogue holds with no message is compared as any other.
    expect(codes(lintCatalogue({ en: {}, cs: { hi: 'Ahoj', bye: 'Nashle' } }))).toEqual(['orphan-message cs hi', 'orphan-message cs bye']);
    expect(codes(lintEntries([{ locale: 'cs', id: 'hi', message: 'Ahoj' }], { source: 'DE', locales: ['de'] }))).toEqual(['orphan-message cs hi']);
  });

  it('duplicate-locale: a spelling the locales list under which no message is read, on the first message of its locale', () => {
    const found = lintCatalogue({ 'en-US': {}, cs: { hi: 'Ahoj' }, 'en-us': { hi: 'Hi', bye: 'Bye' } });

    expect(found.map(({ code, locale, id, message }) => `${code} ${locale} ${id} ${message}`)).toEqual([
      'duplicate-locale en-us hi `en-US`, under which no message was read, is `en-us` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for.',
      'missing-message en-us bye `cs` has no message `bye`.',
    ]);
    expect(codes(lintEntries([{ locale: 'en-us', id: 'hi', message: 'Hi' }], { locales: ['en-US', 'en-US', 'en-us'] }))).toEqual(['duplicate-locale en-us hi']);

    // A locale that holds no message has no message to report it on.
    expect(lintCatalogue({ 'en-US': {}, 'en-us': {}, cs: {} })).toEqual([]);
  });

  it('reads a source that is no string as none named, and a locale that is none as its own', () => {
    const catalogue = { en: { hi: 'Hi {{x}}' }, cs: { hi: 'A' } };
    const named = codes(lintCatalogue(catalogue));

    expect(named).toEqual(['parameter-mismatch cs hi']);

    for (const source of [42, ['en'], null]) expect(codes(lintCatalogue(catalogue, { source: source as never }))).toEqual(named);

    expect(codes(lintEntries([{ id: 'hi', message: 'Hi {{x}}' } as never, { locale: 'cs', id: 'hi', message: 'A' }]))).toEqual(['parameter-mismatch cs hi']);
  });

  it('missing-message: a locale with no message at all lacks every one', () => {
    expect(codes(lintCatalogue({ en: { hi: 'Hello', bye: 'Bye' }, cs: {} }))).toEqual(['missing-message en hi', 'missing-message en bye']);
    expect(codes(lintEntries([{ locale: 'en', id: 'hi', message: 'Hello' }], { locales: ['cs'] }))).toEqual(['missing-message en hi']);
  });

  it('parameter-mismatch: a message reading other parameters than the source', () => {
    const found = lintCatalogue({ en: { hi: 'Hello, {{name}}!' }, cs: { hi: 'Ahoj, {{jmeno}}!' } });

    expect(codes(found)).toEqual(['parameter-mismatch cs hi', 'parameter-mismatch cs hi']);
    expect(found.map(({ message }) => message)).toEqual([
      'This message never reads `name`, which the `en` message reads.',
      '`jmeno` is read here and never in the `en` message, so a payload written for that message does not carry it.',
    ]);
    // The one it reads that the source does not is pointed at.
    expect('Ahoj, {{jmeno}}!'.slice(found[1].start, found[1].end)).toBe('{{jmeno}}');
  });

  it('modifier-mismatch: a parameter shown another way than in the source', () => {
    expect(codes(lintCatalogue({ en: { at: 'Sent {{at:date}}' }, cs: { at: 'Odesl\u00e1no {{at}}' } }))).toEqual(['modifier-mismatch cs at']);
    // Selecting by it, or never showing it, is translation, not a mismatch.
    expect(lintCatalogue({
      en: { n: 'Liked by {{count:number}} people' },
      cs: { n: 'L\u00edb\u00ed se {{count:plural; one:{{count:number}} \u010dlov\u011bku; few:{{count:number}} lidem; many:{{count:number}} \u010dlov\u011bka; other:{{count:number}} lidem;}}' },
    })).toEqual([]);
    expect(lintCatalogue({ en: { n: '{{n:number}} files' }, cs: { n: '{{n; 1:jeden soubor; default:soubory}}' } })).toEqual([]);
    expect(lintCatalogue({ en: { n: '{{n; 1:file; default:files;}}' }, cs: { n: '{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}}' } })).toEqual([]);
  });

  it('missing-number-key: a number key the source selection has and this one lacks', () => {
    const found = lintCatalogue({
      en: { n: '{{n:plural; 0:none; one:file; other:files;}}' },
      cs: { n: '{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}}' },
    });

    expect(codes(found)).toEqual(['missing-number-key cs n']);
    expect(found[0].message).toContain('`0`');
    // A selection around the plural one gives zero its own text too.
    expect(lintCatalogue({
      en: { n: '{{n:plural; 0:none; one:file; other:files;}}' },
      cs: { n: '{{n; 0:nic; default:{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}};}}' },
    })).toEqual([]);
  });

  it('missing-number-key: an `eq` key that spells the number otherwise selects nothing for it', () => {
    expect(codes(lintCatalogue({
      en: { n: '{{n:plural; 1:one file; one:file; other:files;}}' },
      cs: { n: '{{n; 1.0:jeden soubor; default:{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}};}}' },
    }))).toEqual(['missing-number-key cs n']);
  });

  it('compares no placeholder past the nesting limit, which resolution never reaches', () => {
    const wrapped = (inner: string) => `${'{{w; a:'.repeat(8)}${inner}${';}}'.repeat(8)}`;

    expect(codes(lintCatalogue({ en: { m: wrapped('{{x}}') }, cs: { m: wrapped('{{y}}') } }))).toEqual(['nesting-limit en m', 'nesting-limit cs m']);
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

  // A million messages take seconds to lint.
  it('unreadable-catalogue: a tree past a million messages, read no further', { timeout: 30_000 }, () => {
    let doubled: unknown = 'm';

    for (let depth = 0; depth < 21; depth += 1) doubled = { a: doubled, b: doubled };

    const found = lintCatalogue({ en: doubled });

    expect(found).toMatchObject([{ code: 'unreadable-catalogue', locale: 'en', entry: 999999, start: 0, end: 0 }]);
    expect(found[0].message).toContain('1000000');
  });

  it('reads the modifiers Intl defines as unknown for a host without Intl', () => {
    expect(codes(lintCatalogue({ en: { n: '{{n:number}}' }, cs: { n: '{{n:number}}' } }, { intl: false }))).toEqual(['unknown-modifier en n', 'unknown-modifier cs n']);
  });

  it('reads host modifiers as the host\'s', () => {
    const catalogue = { en: { v: '{{v:upper}}' }, cs: { v: '{{v}}' } };

    expect(codes(lintCatalogue(catalogue))).toEqual(['unknown-modifier en v', 'modifier-mismatch cs v']);
    expect(codes(lintCatalogue(catalogue, { modifiers: ['upper'] }))).toEqual(['modifier-mismatch cs v']);
  });

  it('names a message by its index in the entries it was read from', () => {
    const entries = entriesOf({ en: { a: 'A', b: '{{v:zz}}' } });

    expect(entries).toEqual([{ locale: 'en', id: 'a', message: 'A' }, { locale: 'en', id: 'b', message: '{{v:zz}}' }]);
    expect(lintEntries(entries).map(({ entry }) => entry)).toEqual([1]);
  });
});
