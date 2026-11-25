import encoded from '../core.wasm';
import { CATEGORIES, intlPlurals } from './plural';
import type { Plurals, Rules } from './plural';
import { RULES } from './rules';
import type { Rule } from './rules';
import type { CatalogueFinding, Finding, MessageOptions, Options } from './types';

/**
 * The core could not finish a call: the runtime has no WebAssembly, the core
 * ran out of the 2 GiB of memory it may grow to, the stack ran out within the
 * call, or anything else was thrown while it ran, which is the error's
 * `cause`.
 * Nothing was linted, so the call has no findings to give.
 */
export class CoreError extends Error {
  constructor(cause: unknown) {
    super(`The core of @curly-message/lint could not finish: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'CoreError';
  }
}

/** What host code threw while a call read what it was handed. */
class Hosted extends Error {
  constructor(readonly thrown: unknown) {
    super('host code threw');
  }
}

/**
 * Reads what a call is handed, which may run host code: a getter, a
 * `toString`. What that throws leaves the call as it was thrown, and is no
 * `CoreError`, since the core was never asked.
 */
export const fromHost = <Result>(read: () => Result): Result => {
  try {
    return read();
  } catch (error) {
    throw new Hosted(error);
  }
};

/**
 * What a call of the package throws for what it caught: what host code
 * threw as it was read, and anything else as a `CoreError`, a stack that ran
 * out before the core was asked among them.
 */
export const failure = (error: unknown) => (error instanceof Hosted ? error.thrown : error instanceof CoreError ? error : new CoreError(error));

type Call = (at: number, length: number) => number;

type Batch = (list: number, at: number, length: number) => number;

const INTL = 1;
const NAMED = 2;
const UNCOMPARED = 4;

// What the package uses of the runtime's WebAssembly, which the types of no
// runtime it supports declare for all of them.
type Runtime = {
  Module: new (bytes: Uint8Array) => object,
  Instance: new (module: object, imports: Record<string, object>) => { exports: unknown },
};

type Exports = {
  memory: { buffer: ArrayBuffer },
  alloc: (length: number) => number,
  free: (at: number, length: number) => void,
  message: Call,
  push: Batch,
  entries: Batch,
  next: (answers: number) => number,
  read: Call,
  command: Call,
  rules: () => number,
};

/** Why a path cannot be read, and whether it is not there. */
export class Fault {
  constructor(readonly message: string, readonly missing: boolean) {}
}

/**
 * What the command asks of the runtime: the separator of its paths, and an
 * answer to each operation on a text, by the number `rust/wasm/src/host.rs`
 * gives the operation.
 */
export type Host = { separator: string, ask: (op: number, text: string) => string | Uint8Array | Fault };

/** One instance of the core, with what its imports hold for it. */
type Core = {
  exports: Exports,
  /** The rules the instance was handed, which it names by their index. */
  rules: Rules[],
  host?: Host,
  /** What an import threw, which no answer of its own stands in for. */
  thrown?: { error: unknown },
};

// How far an instance's memory may have grown and still be kept. A
// WebAssembly memory never shrinks, so an instance one large call grew is
// dropped for the next call to start a new one.
export const KEPT = 16 * 1024 * 1024;

const encoder = new TextEncoder();
// A byte order mark is a character of the text like any other.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

const bytesOf = ({ exports }: Core, at: number, length: number) => new Uint8Array(exports.memory.buffer, at, length);

// An import never throws into the core and never answers for the runtime:
// what one throws is kept, and `refusal` tells the core to stop.
const guarded = <Arguments extends unknown[]>(core: Core, refusal: number, answer: (...given: Arguments) => number) => (...given: Arguments) => {
  if (core.thrown) return refusal;

  try {
    return answer(...given);
  } catch (error) {
    core.thrown = { error };

    return refusal;
  }
};

const importsOf = (core: Core, plurals: Plurals) => ({
  // The rules' index past the six bits of the categories they answer, and
  // -1 where the runtime has none for the locale.
  plural_rules: guarded(core, -2, (at: number, length: number, ordinal: number) => {
    const rules = plurals(decoder.decode(bytesOf(core, at, length)), ordinal ? 'ordinal' : 'cardinal');

    if (!rules) return -1;

    const answered = rules.categories.reduce((bits, category) => {
      const index = CATEGORIES.indexOf(category);

      if (index < 0) throw new TypeError(`${String(category)} is no plural category`);

      return bits | (1 << index);
    }, 0);

    if (core.rules.length >= 2 ** 24) throw new RangeError('Too many plural rules');

    return (core.rules.push(rules) - 1) * 64 + answered;
  }),
  plural_select: guarded(core, CATEGORIES.length, (rules: number, number: number) => {
    const category = core.rules[rules].select(number);
    const index = CATEGORIES.indexOf(category);

    if (index < 0) throw new TypeError(`${String(category)} is no plural category`);

    return index;
  }),
  // A buffer of the core's: its length, how the operation went, and the
  // answer or what the runtime says of the path.
  host: guarded(core, 0, (op: number, at: number, length: number) => {
    if (!core.host) throw new Error('The core asked for a host outside the command');

    const answer = core.host.ask(op, decoder.decode(bytesOf(core, at, length)));
    const content = answer instanceof Fault ? answer.message : answer;
    const bytes = typeof content === 'string' ? encoder.encode(content) : content;
    const total = bytes.length + 8;
    const to = core.exports.alloc(total);
    const view = new DataView(core.exports.memory.buffer);

    view.setUint32(to, total, true);
    view.setUint32(to + 4, answer instanceof Fault ? (answer.missing ? 2 : 1) : 0, true);
    bytesOf(core, to + 8, bytes.length).set(bytes);

    return to;
  }),
});

let compiled: object | undefined;

// An instance for each set of plural rules, since an instance keeps what it
// was answered.
const cores = new WeakMap<Plurals, Core>();

// The core's bytes, which the bundle holds as text.
const decoded = () => {
  const text = atob(encoded);
  const bytes = new Uint8Array(text.length);

  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);

  return bytes;
};

// Nothing is decoded or compiled before the first call, and the module is
// compiled once.
const instantiate = (plurals: Plurals) => {
  const runtime = (globalThis as unknown as { WebAssembly?: Runtime }).WebAssembly;

  if (!runtime) throw new Error('this runtime has no WebAssembly');

  const { Module, Instance } = runtime;

  compiled ??= new Module(decoded());

  const core: Core = { exports: {} as Exports, rules: [] };

  core.exports = new Instance(compiled, { host: importsOf(core, plurals) }).exports as Exports;
  cores.set(plurals, core);

  return core;
};

// Runs `use` on the instance `plurals` has, or on a new one. Whatever is
// thrown while it runs leaves as a `CoreError`, and the instance is not used
// again.
const run = <Result>(plurals: Plurals, host: Host | undefined, use: (core: Core) => Result): Result => {
  let core: Core | undefined;

  try {
    core = cores.get(plurals) ?? instantiate(plurals);

    const outer = core.host;

    core.host = host;

    const result = use(core);

    core.host = outer;

    if (core.thrown) throw core.thrown.error;
    if (core.exports.memory.buffer.byteLength > KEPT) cores.delete(plurals);

    return result;
  } catch (error) {
    cores.delete(plurals);

    throw new CoreError(core?.thrown ? core.thrown.error : error);
  }
};

/** How many bytes the instance kept for `plurals` holds, and none where none is kept. */
export const held = (plurals: Plurals) => cores.get(plurals)?.exports.memory.buffer.byteLength ?? 0;

/** What a request holds: a number, or a text, which goes with its length. */
type Part = number | string;

// A request as `rust/wasm/src/wire.rs` reads one: how many numbers, the
// numbers, then the texts in UTF-8, each cut by its length in code units
// among the numbers. The texts are encoded as one, since a view of the
// memory for each costs the collector more than the linting. An unpaired
// surrogate is written as U+FFFD.
const request = (core: Core, parts: readonly Part[]): [number, number] => {
  const text = parts.filter((part) => typeof part === 'string').join('');
  const head = 4 + parts.length * 4;
  // A code unit takes three bytes at most.
  const length = head + text.length * 3;
  const at = core.exports.alloc(length);
  const view = new DataView(core.exports.memory.buffer);

  view.setUint32(at, parts.length, true);
  parts.forEach((part, index) => view.setUint32(at + 4 + index * 4, typeof part === 'string' ? part.length : part, true));
  encoder.encodeInto(text, bytesOf(core, at + head, length - head));

  return [at, length];
};

/** What a call answers, as `rust/wasm/src/wire.rs` writes it, read from its start. */
type Answer = { number: () => number, text: () => string };

// Reads what a call answers from the answer at `at`, and from each answer
// it says follows it, giving back each one's buffers once it is read. An
// answer is twenty-eight bytes that place its numbers, its text and where
// each page of the text but the last ends, then where the next answer is
// asked for, or zero. Each text is cut by its length in code units, from
// the page it lies on, and no item lies across two answers.
const answered = <Result>(core: Core, at: number, read: (answer: Answer) => Result): Result => {
  let view: DataView;
  let numbers = 0;
  let count = 0;
  let texts = 0;
  let length = 0;
  let pages = 0;
  let ends = 0;
  let next = 0;
  let index = 0;
  let unit = 0;
  let page = 0;
  let from = 0;
  let text = '';

  const turn = () => {
    const to = page < ends ? view.getUint32(pages + page, true) : length;

    text = decoder.decode(bytesOf(core, texts + from, to - from));
    from = to;
    page += 4;
    unit = 0;
  };

  // Each call into the core may grow its memory, which leaves a view of
  // the buffer before it empty.
  const open = (answer: number) => {
    view = new DataView(core.exports.memory.buffer);
    [numbers, count, texts, length, pages, ends, next] = [0, 4, 8, 12, 16, 20, 24].map((offset) => view.getUint32(answer + offset, true));
    core.exports.free(answer, 28);
    index = 0;
    page = 0;
    from = 0;
    turn();
  };

  const close = () => {
    core.exports.free(numbers, count);
    core.exports.free(texts, length);
    core.exports.free(pages, ends);
  };

  // Every item begins with a number, a text with its length, so an answer
  // is turned to here and an item read whole from one.
  const number = () => {
    if (index >= count && next) {
      close();
      open(core.exports.next(next));
    }

    const read = index < count ? view.getUint32(numbers + index, true) : 0;

    index += 4;

    return read;
  };

  open(at);

  const result = read({
    number,
    text: () => {
      const units = number();

      if (unit + units > text.length && from < length) turn();

      return text.slice(unit, unit += units);
    },
  });

  close();

  return result;
};

const call = <Result>(plurals: Plurals, name: 'message' | 'read', parts: readonly Part[], read: (answer: Answer) => Result): Result => run(plurals, undefined, (core) => answered(core, core.exports[name](...request(core, parts)), read));

const listed = <Item>(answer: Answer, item: (answer: Answer) => Item): Item[] => Array.from({ length: answer.number() }, () => item(answer));

const textsOf = (given: unknown): string[] => (Array.isArray(given) ? given.filter((text) => typeof text === 'string') : []);

/** What a call to lint is made with, read off its options once. */
export type Opened = { flags: number, named?: string, modifiers: string[], locales: string[] };

/**
 * Reads a call's options, the locale or the source among them that it
 * names, where it names one, and the locales a list is written for: what an
 * option that is not of its type holds is not read.
 */
export const opened = (options: Options, named: unknown, locales?: unknown): Opened => ({
  flags: options.intl === false ? 0 : INTL,
  ...(typeof named === 'string' ? { named } : {}),
  modifiers: textsOf(options.modifiers),
  locales: textsOf(locales),
});

// What every request to lint opens with: its flags, the locale or the source
// it names, where it names one, and the modifiers the host registers.
const opening = ({ flags, named, modifiers }: Opened, more: number): Part[] => [flags | more | (named === undefined ? 0 : NAMED), ...(named === undefined ? [] : [named]), modifiers.length, ...modifiers];

// A finding but for where it is, as the core writes one.
const found = (answer: Answer): Omit<Finding, 'start' | 'end'> => {
  const rule = answer.number();
  const message = answer.text();
  const section = answer.text();

  return { code: RULES[rule & 255].code, severity: rule >> 8 ? 'warning' : 'error', message, ...(section ? { section } : {}) };
};

const finding = (answer: Answer): Finding => ({ ...found(answer), start: answer.number(), end: answer.number() });

/** Whether a text holds a surrogate that pairs with no other. */
export const unpaired = (text: unknown) => (typeof text === 'string' ? /\p{Cs}/u.exec(text)?.[0] : undefined);

/** Lints one message as `lintMessage` does, with the plural rules `plurals` has. */
export const lintMessageWith = (plurals: Plurals) => (message: string, options: MessageOptions = {}): Finding[] => {
  try {
    if (typeof message !== 'string' || unpaired(message)) return [];

    let locale: unknown;
    let modifiers: unknown;
    let intl: unknown;

    // Read in place rather than through `fromHost`, so that a stack that
    // runs out on the way to the core is a `CoreError`.
    try {
      ({ locale, modifiers, intl } = options);
    } catch (error) {
      throw new Hosted(error);
    }

    const given = { ...opened({ intl } as Options, locale), modifiers: modifiers === undefined ? [] : fromHost(() => textsOf(modifiers)) };

    return call(plurals, 'message', [...opening(given, 0), message], (answer) => listed(answer, finding));
  } catch (error) {
    throw failure(error);
  }
};

/**
 * Lints one message: everything its text decides, and, given its locale, what
 * the locale's plural rules decide as well. Text that is not well-formed
 * Unicode, holding a surrogate that pairs with no other, has no findings.
 */
export const lintMessage = lintMessageWith(intlPlurals);

/** A message, the id a catalogue gives it and the locale it is written for. */
export type Entry = { locale: string, id: string, message: string };

/**
 * How many code units a batch of entries holds at most, but for one entry
 * longer on its own, which crosses alone: what crosses into the core at
 * once grows with no list.
 */
export const BATCH = 65_536;

/** What an entry weighs in a batch beside its text, so that no batch holds more than `BATCH / ENTRY` entries. */
export const ENTRY = 4;

/**
 * Lints entries, three texts each in `texts` (its locale, its id and its
 * message), as one catalogue, comparing no locale with the source one where
 * `uncompared`. A finding names its entry's locale and id as `named` holds
 * them, two an entry. An unpaired surrogate reads as U+FFFD, as a command's
 * arguments converted lossily do.
 */
export const lintEntriesIn = (plurals: Plurals, texts: readonly string[], named: readonly unknown[], given: Opened, uncompared: boolean): CatalogueFinding[] => run(plurals, undefined, (core) => {
  // The opening, then how many entries the batch holds, written once known.
  let parts: Part[] = [...opening(given, uncompared ? UNCOMPARED : 0), given.locales.length, ...given.locales, 0];
  let counted = parts.length - 1;
  let list = 0;
  let weight = 0;

  for (let at = 0; at < texts.length; at += 3) {
    const size = texts[at].length + texts[at + 1].length + texts[at + 2].length + ENTRY;

    if (weight > 0 && weight + size > BATCH) {
      parts[counted] = (parts.length - counted - 1) / 3;
      list = core.exports.push(list, ...request(core, parts));
      parts = [0];
      counted = 0;
      weight = 0;
    }

    parts.push(texts[at], texts[at + 1], texts[at + 2]);
    weight += size;
  }

  parts[counted] = (parts.length - counted - 1) / 3;

  return answered(core, core.exports.entries(list, ...request(core, parts)), (answer) => listed(answer, () => {
    const entry = answer.number();

    return { ...finding(answer), locale: named[entry * 2] as string, id: named[entry * 2 + 1] as string, entry };
  }));
});

/** A string of a catalogue file as the core reads it, each of its escape sequences by the code unit it spells and how long it is written. */
export type Text = { path: string[], value: string, start: number, end: number, escapes: [number, number][] };

/** A catalogue file's text as the core reads it, and what reading it finds. */
export type TextRead = {
  findings: Finding[],
  read: { ok: true, strings: Text[], replaced: { path: string[], start: number, end: number }[] } | { ok: false, message: string, offset: number },
};

const pathOf = (answer: Answer) => listed(answer, () => answer.text());

export const readText = (text: string): TextRead => call(intlPlurals, 'read', [text], (answer) => {
  const findings = listed(answer, finding);

  if (!answer.number()) {
    const message = answer.text();

    return { findings, read: { ok: false, message, offset: answer.number() } };
  }

  const replaced = listed(answer, () => ({ path: pathOf(answer), start: answer.number(), end: answer.number() }));
  const strings = listed(answer, () => ({
    path: pathOf(answer),
    value: answer.text(),
    start: answer.number(),
    end: answer.number(),
    escapes: listed(answer, (): [number, number] => [answer.number(), answer.number()]),
  }));

  return { findings, read: { ok: true, strings, replaced } };
});

const SCOPES = ['message', 'locale', 'catalogue'] as const;

/** The table of rules the core holds. */
export const rulesOfCore = (): Rule[] => run(intlPlurals, undefined, (core) => answered(core, core.exports.rules(), (answer) => listed(answer, () => {
  const severity = answer.number() ? 'warning' : 'error';
  const scope = SCOPES[answer.number()];
  const code = answer.text() as Rule['code'];
  const section = answer.text();

  return { code, severity, scope, ...(section ? { section } : {}), description: answer.text() };
})));

/** Runs the `curly-lint` command over a host, and answers its exit code. */
export const command = (plurals: Plurals, argv: readonly string[], host: Host): number => run(plurals, host, (core) => core.exports.command(...request(core, [host.separator.codePointAt(0) ?? 0, argv.length, ...argv])));
