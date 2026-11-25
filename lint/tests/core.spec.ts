import { describe, expect, it, vi } from 'vitest';
import { CoreError, lintCatalogue, lintEntries, lintMessage, readCatalogue, RULES } from '@curly-message/lint';
import type { Entry } from '@curly-message/lint';
import { BATCH, ENTRY, held, KEPT, lintEntriesWith, lintMessageWith, rulesOfCore } from '#internal';
import type { Plurals, Rules } from '#internal';

// Plural rules of the test's own, so that the instance of the core they are
// handed to is the test's own too.
const plurals = (select: (number: number) => string = () => 'other'): Plurals => () => ({ categories: ['one', 'other'], select: select as Rules['select'] });

const selection = '{{n:plural; one:a; other:b;}}';

describe('the core', () => {
  // The million messages a tree is read up to are counted here, where the
  // tree is walked, so the core's description of the rule names no such
  // bound.
  it('holds the rules of `RULES`, each as `RULES` states it', () => {
    const described: Record<string, string> = {
      'unreadable-catalogue': 'A catalogue read only up to where it is not JSON, is not well-formed Unicode text or nests past 512 levels.',
    };

    expect(rulesOfCore()).toEqual(RULES.map((rule) => (rule.code in described ? { ...rule, description: described[rule.code] } : rule)));
  });

  it('keeps no instance a large call grew, and lints the next call', () => {
    const host = plurals();
    const lint = lintEntriesWith(host);

    expect(lint([{ locale: 'en', id: 'a', message: '{{' }])).toHaveLength(1);
    expect(held(host)).toBeGreaterThan(0);
    expect(held(host)).toBeLessThanOrEqual(KEPT);

    const kept = held(host);
    const many = Array.from({ length: 100_000 }, (_, index) => ({ locale: 'en', id: `message.${index}`, message: 'Hello, {{name}}! You have {{count}} new messages.' }));

    expect(lint(many)).toEqual([]);
    expect(held(host)).toBe(0);

    expect(lint([{ locale: 'en', id: 'a', message: '{{' }])).toHaveLength(1);
    expect(held(host)).toBe(kept);
  });

  it('throws a `CoreError` where the plural rules it is handed throw, and lints the next call', () => {
    const thrown = new Error('no rules today');
    let failing = true;
    const host: Plurals = (tag, type) => {
      if (failing) throw thrown;

      return plurals()(tag, type);
    };
    const lint = lintMessageWith(host);
    const caught = (() => {
      try {
        return lint(selection, { locale: 'en' });
      } catch (error) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(CoreError);
    expect(caught).toMatchObject({ name: 'CoreError', cause: thrown, message: 'The core of @curly-message/lint could not finish: no rules today' });
    expect(held(host)).toBe(0);

    failing = false;
    expect(lint(selection, { locale: 'en' })).toEqual([]);
    expect(lint('{{')).toMatchObject([{ code: 'unclosed-placeholder' }]);
  });

  it('throws a `CoreError` where the plural rules answer what is no category', () => {
    for (const host of [plurals(() => 'several'), (): Rules => ({ categories: ['several' as never], select: () => 'other' })]) {
      expect(() => lintMessageWith(host)(selection, { locale: 'en' })).toThrow(CoreError);
      expect(held(host)).toBe(0);
    }
  });

  it('never calls the plural rules for a message that selects by none', () => {
    const host: Plurals = () => {
      throw new Error('asked');
    };

    expect(lintMessageWith(host)('Hello, {{name}}!', { locale: 'en' })).toEqual([]);
  });

  it('throws a `CoreError` where the runtime\'s `Intl` throws, and lints by it once it no longer does', () => {
    const thrown = new Error('Intl is out of order');
    const supported = vi.spyOn(Intl.PluralRules, 'supportedLocalesOf').mockImplementation(() => {
      throw thrown;
    });

    try {
      expect(() => lintMessage('{{n:plural; one:a;}}', { locale: 'ru' })).toThrow(expect.objectContaining({ name: 'CoreError', cause: thrown }));
    } finally {
      supported.mockRestore();
    }

    expect(lintMessage('{{n:plural; one:a;}}', { locale: 'ru' }).map(({ code, message }) => [code, message.slice(0, 22)])).toEqual([
      ['missing-category', '`ru` puts 0, 5 and 6 i'],
      ['missing-category', '`ru` puts 0.5, 1.5 and'],
      ['missing-category', '`ru` puts 2, 3 and 4 i'],
    ]);
  });

  it('asks the runtime\'s `Intl` for the rules of a locale exactly where `Intl` takes its tag', () => {
    const tags = [
      'en', 'EN_us', 'de-CH-1996', 'sr-Latn-RS', 'zh-Hant-TW', 'es-419', 'en-u-ca-gregory', 'en-u-attr-ca-gregory-nu-latn', 'en-u-ca', 'de-t-en-us-h0-hybrid',
      'en-a-bbb-x-a-ccc', 'en-x-private', 'art-lojban', 'cel-gaulish', 'abcde', 'abcdefgh', 'und', 'tlh', 'de-1996', 'sl-rozaj-biske-1994',
      '', 'not a locale', 'e', 'abcd', 'abcdefghi', 'en-', '-en', 'en--us', 'en-us-', 'i-klingon', 'x-private', 'en-x', 'en-u', 'en-t', 'en-a-b',
      'de-1996-1996', 'en-u-ca-gregory-u-nu-latn', 'en-a-bbb-a-ccc', 'en-u-a1', 'en-t-h0', 'en-t-en-h0', 'en-t-en-us-en', 'sl-rozaj-rozaj', 'en-\u00e9', 'en-US-u-ca-gregory-x-a-b-c-defghijkl',
    ];
    const asked = new Set<string>();
    const lint = lintMessageWith((tag) => {
      asked.add(tag);

      return undefined;
    });
    const taken = (tag: string) => {
      try {
        return Intl.getCanonicalLocales(tag).length > 0;
      } catch {
        return false;
      }
    };

    for (const tag of tags) lint(selection, { locale: tag });

    expect(tags.filter((tag) => asked.has(tag.toLowerCase().replaceAll('_', '-')))).toEqual(tags.filter((tag) => taken(tag.replaceAll('_', '-'))));
  });

  it('lints with the runtime\'s own rules after another host\'s failed', () => {
    expect(() => lintMessageWith(() => {
      throw new Error('asked');
    })(selection, { locale: 'en' })).toThrow(CoreError);
    expect(lintMessage(selection, { locale: 'en' })).toEqual([]);
  });
});

// The types of no runtime the package supports declare WebAssembly.
type Memory = { buffer: ArrayBuffer, grow: (pages: number) => number };
type Call = (...given: number[]) => number;
type Exports = { memory: Memory, alloc: Call, push: Call, entries: Call, next: Call, message: Call, read: Call };
type Made = { get exports(): Exports };
type Runtime = { Instance: new (module: object, imports: object) => Made };

/** What the instances a call starts are asked, as the package asks them. */
type Watched = {
  /** The exports of each instance, as the module gives them. */
  instances: Exports[],
  /** The largest buffer asked for, and how many batches crossed before the last. */
  largest: number,
  pushes: number,
  /** The bytes each answer holds, in the order they crossed. */
  answers: number[],
  /** What runs in place of a batch's crossing before it crosses. */
  pushing?: () => void,
};

// The core's instances, each export wrapped to count what crosses it.
const watching = <Result>(use: (watched: Watched) => Result): Result => {
  const runtime = (globalThis as unknown as { WebAssembly: Runtime }).WebAssembly;
  const { Instance } = runtime;
  const watched: Watched = { instances: [], largest: 0, pushes: 0, answers: [] };

  runtime.Instance = class extends Instance {
    readonly wrapped: Exports;

    constructor(module: object, imports: object) {
      super(module, imports);

      const raw = super.exports;
      const answer = (at: number) => {
        const view = new DataView(raw.memory.buffer);

        watched.answers.push(view.getUint32(at + 4, true) + view.getUint32(at + 12, true));

        return at;
      };

      watched.instances.push(raw);
      this.wrapped = {
        ...raw,
        alloc: (length) => {
          watched.largest = Math.max(watched.largest, length);

          return raw.alloc(length);
        },
        push: (...given) => {
          watched.pushes += 1;
          watched.pushing?.();

          return raw.push(...given);
        },
        entries: (...given) => answer(raw.entries(...given)),
        next: (...given) => answer(raw.next(...given)),
        message: (...given) => answer(raw.message(...given)),
        read: (...given) => answer(raw.read(...given)),
      };
    }

    get exports() {
      return this.wrapped;
    }
  };

  try {
    return use(watched);
  } finally {
    runtime.Instance = Instance;
  }
};

// The most a batch of entries no longer than `BATCH` asks for: three bytes
// a code unit, and four bytes for each number, three an entry, its count
// and the request's.
const BATCHED = 3 * BATCH + 4 * (3 * (BATCH / ENTRY) + 2);

// About how many bytes an answer holds, `ANSWER` in `rust/wasm/src/lib.rs`:
// it ends with the first item past them.
const ANSWER = 2 ** 20;

// A page of the module's memory, and the most it grows to.
const PAGE = 65_536;
const MOST = 2 ** 31 / PAGE;

const intl: Plurals = (tag, type) => {
  const rules = new Intl.PluralRules(tag, { type });

  return { categories: rules.resolvedOptions().pluralCategories, select: (number) => rules.select(number) };
};

// Entries of two locales, a pair an id, three findings each.
const pairs = (count: number) => {
  const message = '{{count:plural; one:{{count}} file; other:{{count}} files}} in {{folder}}.';

  return Array.from({ length: count }, (_, index) => ({ locale: index % 2 ? 'en' : 'cs', id: `key.${String(index >> 1).padStart(6, '0')}`, message }));
};

describe('a large list of entries', () => {
  const shown = ({ code, message, start, end }: { code: string, message: string, start: number, end: number }) => ({ code, message, start, end });

  // A hundred thousand entries, three findings each, whose findings run past
  // what an answer holds many times over.
  it('crosses in batches and answers in pieces that grow with no list, and reads every finding', { timeout: 60_000 }, () => {
    const crossed = (count: number) => watching((watched) => {
      const entries = pairs(count);
      const lint = lintEntriesWith((tag, type) => intl(tag, type));
      const one = lint(entries.slice(0, 2), { source: 'en' });
      const found = lint(entries, { source: 'en' });
      // Each entry's code units and its weight beside them, all alike.
      const weight = entries[0].locale.length + entries[0].id.length + entries[0].message.length + ENTRY;

      expect(one).toHaveLength(6);
      expect(found).toHaveLength(3 * count);
      expect(found.every((finding, index) => finding.entry === 2 * Math.floor(index / 6) + one[index % 6].entry)).toBe(true);
      expect(found.every((finding, index) => JSON.stringify(shown(finding)) === JSON.stringify(shown(one[index % 6])))).toBe(true);
      expect(watched.pushes).toBe(Math.ceil(count / Math.floor(BATCH / weight)) - 1);

      return watched;
    });
    const small = crossed(10_000);
    const large = crossed(100_000);

    expect(large.largest).toBeLessThanOrEqual(BATCHED);
    expect(large.largest).toBe(small.largest);
    expect(Math.max(...large.answers)).toBeLessThan(ANSWER + 1024);
    expect(large.answers.length).toBeGreaterThan(10);
  });

  // A finding holds what it quotes as text of its own, beside the message's,
  // and the memory a call grows takes half as much again as what it is
  // asked for, ahead of the next ask: the factor and the constants are what
  // these shapes measure, with text counted as the core holds it, in UTF-8.
  it('holds a list within twice its text and its findings\', 400 bytes a message and 300 a finding', { timeout: 120_000 }, () => {
    const encoder = new TextEncoder();
    const bytes = (text: string) => encoder.encode(text).length;
    const clean = (count: number) => Array.from({ length: count }, (_, index) => ({ locale: 'en', id: `k${index}`, message: 'Hello, {{name}}! You have {{count}} new messages.' }));
    // A modifier no one registered, which its finding quotes whole.
    const quoting = (count: number) => Array.from({ length: count }, (_, index) => ({ locale: 'en', id: `k${index}`, message: `{{a:${'\u65e5'.repeat(300)}}}` }));
    const grown = (entries: Entry[]) => watching(({ instances }) => {
      const found = lintEntriesWith((tag, type) => intl(tag, type))(entries, { source: 'en' });
      const text = entries.reduce((sum, { locale, id, message }) => sum + bytes(locale) + bytes(id) + bytes(message), 0);
      const quoted = found.reduce((sum, { message }) => sum + bytes(message), 0);
      const memory = instances[0].memory.buffer.byteLength;

      expect(memory).toBeLessThanOrEqual(2 * (text + quoted + 400 * entries.length + 300 * found.length));

      return memory;
    });

    grown(quoting(50_000));
    grown(clean(100_000));
    expect(grown(pairs(400_000))).toBeLessThanOrEqual(4.4 * grown(pairs(100_000)));
  });

  it('weighs an entry beside its text, so that empty entries cross in batches too', () => {
    watching((watched) => {
      const count = 100_000;
      const empty = Array.from({ length: count }, () => ({ locale: '', id: '', message: '' }));

      lintEntriesWith(plurals())(empty);
      expect(watched.pushes).toBe(Math.ceil(count / (BATCH / ENTRY)) - 1);
      expect(watched.largest).toBeLessThanOrEqual(BATCHED);
    });
  });

  it('hands an entry longer than a batch over alone, and whole', () => {
    watching((watched) => {
      const long = `${'a'.repeat(3 * BATCH)}{{`;
      const found = lintEntriesWith(plurals())([{ locale: 'en', id: 'a', message: '{{' }, { locale: 'en', id: 'b', message: long }, { locale: 'en', id: 'c', message: '{{' }]);

      expect(found.map(({ id, start }) => ({ id, start }))).toEqual([{ id: 'a', start: 0 }, { id: 'b', start: 3 * BATCH }, { id: 'c', start: 0 }]);
      expect(watched.pushes).toBe(2);
      expect(watched.largest).toBeGreaterThanOrEqual(3 * long.length);
    });
  });

  it('answers a call the core lints between two batches, and the list it was in', () => {
    const host = plurals();
    const lint = lintEntriesWith(host);
    const entries = Array.from({ length: 2 * BATCH / ENTRY }, (_, index) => ({ locale: 'en', id: `${index}`, message: index % 1000 ? '' : '{{' }));
    const inner: unknown[] = [];

    watching((watched) => {
      watched.pushing = () => {
        if (inner.length === 0) inner.push(...lint([{ locale: 'en', id: 'inner', message: '{{a:b}}' }]));
      };

      expect(lint(entries).map(({ id }) => id)).toEqual(Array.from({ length: Math.ceil(entries.length / 1000) }, (_, index) => `${index * 1000}`));
      expect(watched.pushes).toBeGreaterThan(0);
    });
    expect(inner).toMatchObject([{ code: 'unknown-modifier', id: 'inner' }]);
  });

  it('answers a call the plural rules make on the same instance while it lints, and the list it was in', () => {
    let inner: unknown[] = [];
    const host: Plurals = () => ({
      categories: ['one', 'other'],
      select: () => {
        if (inner.length === 0) inner = lint([{ locale: 'en', id: 'inner', message: '{{a:b}}' }]);

        return 'other';
      },
    });
    const lint = lintEntriesWith(host);
    const found = lint([{ locale: 'en', id: 'outer', message: '{{n:plural; one:a; other:b; two:c;}} {{' }]);

    expect(found.map(({ code, id }) => ({ code, id }))).toEqual([{ code: 'unused-category', id: 'outer' }, { code: 'unclosed-placeholder', id: 'outer' }]);
    expect(inner).toMatchObject([{ code: 'unknown-modifier', id: 'inner' }]);
  });
});

describe('what an entry holds', () => {
  it('converts a locale or an id that is no string once, and reads each field of an entry once', () => {
    const read = { locale: 0, id: 0, message: 0, converted: 0 };
    const locale = {
      toString: () => {
        read.converted += 1;

        return 'en';
      },
    };
    const entry = {
      get locale() {
        read.locale += 1;

        return locale;
      },
      get id() {
        read.id += 1;

        return 'a';
      },
      get message() {
        read.message += 1;

        return '{{';
      },
    };

    expect(lintEntries([entry as unknown as Entry])).toMatchObject([{ code: 'unclosed-placeholder', locale, id: 'a' }]);
    expect(read).toEqual({ locale: 1, id: 1, message: 1, converted: 1 });
  });

  it('throws what a `toString` throws as it was thrown, before the core is asked', () => {
    const thrown = new Error('no text today');
    const locale = {
      toString: () => {
        throw thrown;
      },
    };

    expect(() => lintEntries([{ locale: 'en', id: 'a', message: '{{' }, { locale: locale as unknown as string, id: 'b', message: '' }])).toThrow(thrown);
    expect(lintEntries([{ locale: 'en', id: 'a', message: '{{' }])).toHaveLength(1);
  });

  it('lints a list a `toString` lints, and then its own', () => {
    let inner: unknown[] = [];
    const locale = {
      toString: () => {
        inner = lintEntries([{ locale: 'en', id: 'inner', message: '{{a:b}}' }]);

        return 'en';
      },
    };
    const found = lintEntries([{ locale: 'en', id: 'outer', message: '{{' }, { locale: locale as unknown as string, id: 'next', message: '{{c:d}}' }]);

    expect(found.map(({ code, id }) => ({ code, id }))).toEqual([{ code: 'unclosed-placeholder', id: 'outer' }, { code: 'unknown-modifier', id: 'next' }]);
    expect(inner).toMatchObject([{ code: 'unknown-modifier', id: 'inner' }]);
  });
});

describe('a long answer', () => {
  it('reads a message\'s findings across the answers they take', () => {
    watching((watched) => {
      const count = 20_000;
      const found = lintMessageWith(plurals())('{{a:b}}'.repeat(count));

      expect(found).toHaveLength(count);
      expect(found.at(-1)).toMatchObject({ code: 'unknown-modifier', start: 7 * count - 3, end: 7 * count - 2 });
      expect(watched.answers.length).toBeGreaterThan(1);
    });
  });

  it('cuts an entry\'s findings across answers, each about as long as `ANSWER`', () => {
    watching((watched) => {
      const count = 20_000;
      const found = lintEntriesWith(plurals())([{ locale: 'en', id: 'long', message: '{{a:b}}'.repeat(count) }], { source: 'en' });

      expect(found).toHaveLength(count);
      expect(found.at(-1)).toMatchObject({ code: 'unknown-modifier', id: 'long', start: 7 * count - 3, end: 7 * count - 2 });
      expect(watched.answers.length).toBeGreaterThan(1);
      expect(Math.max(...watched.answers)).toBeLessThan(ANSWER + 1024);
    });
  });

  // More than an answer holds, on the instance the runtime's plural rules
  // have.
  it('reads a file\'s strings across the answers they take', () => {
    const count = 50_000;
    const read = readCatalogue(JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, index) => [`key.${index}`, `\u00e9 message number ${index}`]))));

    expect(read.ok && read.strings.length).toBe(count);
    expect(read.ok && read.strings.at(-1)).toMatchObject({ path: [`key.${count - 1}`], value: `\u00e9 message number ${count - 1}` });
  });
});

describe('the core\'s memory', () => {
  // A memory grown past the 2 GiB the module declares would give an address
  // the host reads as a negative number.
  it('grows to 2 GiB and no further', () => {
    watching(({ instances }) => {
      lintEntriesWith(plurals())([{ locale: 'en', id: 'a', message: '{{' }]);

      const [{ memory }] = instances;

      memory.grow(MOST - memory.buffer.byteLength / PAGE);
      expect(memory.buffer.byteLength).toBe(2 ** 31);
      expect(() => memory.grow(1)).toThrow(RangeError);
    });
  });

  // A runtime collects its garbage each time a memory grows, so growing it
  // a page at a time near its most costs a collection a page.
  it('grows by what is left, near the most it grows to, rather than a page at a time', () => {
    watching(({ instances }) => {
      lintEntriesWith(plurals())([{ locale: 'en', id: 'a', message: '{{' }]);

      const [{ memory, alloc }] = instances;
      const sizes = new Set<number>();

      memory.grow(MOST - 1024 - memory.buffer.byteLength / PAGE);
      expect(() => {
        for (;;) {
          alloc(PAGE);
          sizes.add(memory.buffer.byteLength);
        }
      }).toThrow();
      expect(sizes.size).toBeLessThanOrEqual(4);
    });
  });
});

describe('a tree past a million messages', () => {
  // The finding the tree's walk adds joins the core's at its own place: it
  // stands at no text, so before what the core finds in the same message.
  it('names the last message read before what that message holds, and after the message before it', { timeout: 60_000 }, () => {
    let doubled: unknown = '{{';

    for (let depth = 0; depth < 20; depth += 1) doubled = { a: doubled, b: doubled };

    const found = lintCatalogue({ en: { x: doubled, y: doubled }, cs: { open: '{{' } }, { intl: false });
    const last = found.filter(({ entry }) => entry >= 999_998).map(({ code, locale, entry, start }) => ({ code, locale, entry, start }));

    expect(found).toHaveLength(1_000_002);
    expect(last).toEqual([
      { code: 'unclosed-placeholder', locale: 'en', entry: 999_998, start: 0 },
      { code: 'unreadable-catalogue', locale: 'en', entry: 999_999, start: 0 },
      { code: 'unclosed-placeholder', locale: 'en', entry: 999_999, start: 0 },
      { code: 'unclosed-placeholder', locale: 'cs', entry: 1_000_000, start: 0 },
    ]);
  });
});
