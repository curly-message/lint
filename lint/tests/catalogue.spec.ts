import { describe, expect, it } from 'vitest';
import { entriesOf, flatten, lintCatalogue, lintEntries } from '../src';

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
    expect(lintCatalogue(catalogue, { source: 'fr' })).toEqual([]);
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

  it('compares nothing with a message nested deeper than a call stack goes', () => {
    const deep = `${'{{v; a:'.repeat(5000)}x${'}}'.repeat(5000)}`;

    expect(codes(lintCatalogue({ en: { m: deep }, cs: { m: '{{w}}' } }))).toEqual(['nesting-limit en m']);
  });

  it('compares messages in time that grows with them, not with their square', () => {
    const message = Array.from({ length: 20000 }, (_, index) => `{{p${index}}}`).join(' ');
    const plural = `{{n:plural; ${Array.from({ length: 40000 }, (_, index) => `${index}:x`).join('; ')}; other:y;}}`;
    const started = performance.now();

    lintCatalogue({ en: { message, plural }, cs: { message, plural } });

    expect(performance.now() - started).toBeLessThan(1500);
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
