import { definedBy, finding, FORMATTING, lintTree, quoted, readingOf, resolvable } from './message';
import { numberOf } from './plural';
import { read } from './tree';
import type { Placeholder, Tree } from './tree';
import type { Catalogue, CatalogueFinding, CatalogueOptions, Code, EntriesOptions, Finding } from './types';

/** A message, the id a catalogue gives it and the locale it is written for. */
export type Entry = { locale: string, id: string, message: string };

// An object's own enumerable members that hold a value. An accessor is never
// read, as reading one calls a function the catalogue holds, and an object
// that refuses to list its members has none.
const own = (value: unknown): [string, unknown][] => {
  if (value === null || typeof value !== 'object') return [];

  try {
    const members: [string, unknown][] = [];

    for (const key of Object.keys(value)) {
      const member = Object.getOwnPropertyDescriptor(value, key);

      if (member && 'value' in member) members.push([key, member.value]);
    }

    return members;
  } catch {
    return [];
  }
};

// How many messages a tree is read for at most. An object a tree holds in
// several places is read in each, which a tree that nests such objects
// multiplies past any bound.
const MAX_MESSAGES = 1_000_000;

type Step = { path?: string, value: unknown } | { left: object, from: number };

// The messages a tree holds, and whether it holds more than are read. An
// object a tree holds inside itself is read once, where it is first reached,
// and one found to hold no message is not read again.
const walk = (tree: unknown) => {
  const messages: { id: string, message: string }[] = [];
  const open = new Set<object>();
  const empty = new WeakSet<object>();
  // Walked with a list rather than the call stack, which a deep tree outgrows.
  const pending: Step[] = [{ value: tree }];

  for (let step = pending.pop(); step; step = pending.pop()) {
    if ('left' in step) {
      open.delete(step.left);
      if (messages.length === step.from) empty.add(step.left);
      continue;
    }

    const { path, value } = step;

    if (typeof value === 'string' && path !== undefined) {
      if (messages.length === MAX_MESSAGES) return { messages, cut: true };
      messages.push({ id: path, message: value });
      continue;
    }

    if (value === null || typeof value !== 'object' || open.has(value) || empty.has(value)) continue;

    open.add(value);
    pending.push({ left: value, from: messages.length });

    const children = own(value);

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [key, child] = children[index];

      pending.push({ path: path === undefined ? key : `${path}.${key}`, value: child });
    }
  }

  return { messages, cut: false };
};

/**
 * The messages a tree holds, in the order it holds them: each string leaf, by
 * the path to it joined with dots, up to a million. A leaf that is not a
 * string is not a message, and two paths that join to one id are both listed.
 */
export const flatten = (tree: unknown): { id: string, message: string }[] => walk(tree).messages;

/** The messages of a catalogue, locale by locale. */
export const entriesOf = (catalogue: Catalogue): Entry[] => own(catalogue)
  .flatMap(([locale, tree]) => flatten(tree).map(({ id, message }) => ({ locale, id, message })));

const PLURALS = ['plural', 'ordinal'];

/** How the rules read a placeholder's modifier: the modifiers the host has, and those it registers. */
type Modifiers = { defined: readonly string[], hosted: readonly string[] };

// The format's own selection a placeholder makes, as the rules of a message
// read it: a formatting modifier selects nothing.
const selectionOf = (placeholder: Placeholder, { defined, hosted }: Modifiers) => {
  const reading = readingOf(placeholder, defined, hosted);

  return reading?.own && !FORMATTING.includes(reading.name) ? reading.name : undefined;
};

// How a placeholder shows its value: with the formatting modifier or the
// host's modifier it names, or as it is. A selection shows nothing of it.
const shownWith = (placeholder: Placeholder, modifiers: Modifiers) => (selectionOf(placeholder, modifiers) ? undefined : placeholder.modifier?.name ?? '');

/** The placeholders resolution reaches that name a key, by the key. */
type Names = Map<string, Placeholder[]>;

const namesOf = (tree: Tree): Names => {
  const names: Names = new Map();

  for (const placeholder of resolvable(tree)) {
    if (!placeholder.key) continue;

    const named = names.get(placeholder.key.name);

    if (named) named.push(placeholder);
    else names.set(placeholder.key.name, [placeholder]);
  }

  return names;
};

/** A message a locale is compared by, and its names where it could be read. */
type Read = { entry: number, names?: Names };

// The numbers the options of selections give text of their own. A number key
// of `plural` selects for the number it reads as (section 11.5), and a key of
// `eq` only for the number whose text it spells (section 11.1).
const numbersOf = (placeholders: Placeholder[], spelled: boolean) => placeholders.flatMap(({ segments }) => segments.flatMap(({ name }) => {
  const number = name === 'default' ? undefined : numberOf(name);

  return number === undefined || (spelled && String(number) !== name.toLowerCase()) ? [] : [number];
}));

/**
 * Lints a list of messages as one catalogue: each message, each with its
 * locale, then every locale against the source one. A finding names its
 * message by `entry`, the index of the message in `entries`.
 */
export const lintEntries = (entries: readonly Entry[], options: EntriesOptions = {}): CatalogueFinding[] => {
  const hosted = options.modifiers ?? [];
  const modifiers = { defined: definedBy(options.intl), hosted };
  const findings: CatalogueFinding[] = [];
  const add = (entry: number, found: Finding) => findings.push({ ...found, locale: entries[entry].locale, id: entries[entry].id, entry });
  const make = (entry: number, code: Code, section: string | undefined, message: string, start = 0, end = 0) => add(entry, finding(code, section, message, start, end));

  // The first message under an id is the one a locale is compared by.
  const locales = new Map<string, Map<string, Read>>((options.locales ?? []).map((locale) => [locale, new Map()]));

  entries.forEach(({ locale, id, message }, entry) => {
    const tree = read(message);

    for (const found of lintTree(message, tree, { modifiers: hosted, intl: options.intl, locale })) add(entry, found);

    const messages = locales.get(locale) ?? new Map<string, Read>();

    locales.set(locale, messages);

    if (messages.has(id)) {
      make(entry, 'duplicate-id', undefined, `${quoted(id)} is defined again in ${quoted(locale)}, so one of the two messages is never read.`);
    } else {
      messages.set(id, { entry, names: tree && namesOf(tree) });
    }
  });

  const source = options.source ?? (locales.has('en') ? 'en' : [...locales.keys()][0]);
  const reference = locales.get(source);

  if (!reference) return findings;

  for (const [locale, messages] of locales) {
    if (locale === source) continue;

    for (const [id, { entry }] of reference) {
      if (!messages.has(id)) make(entry, 'missing-message', undefined, `${quoted(locale)} has no message ${quoted(id)}.`);
    }

    for (const [id, { entry, names }] of messages) {
      const compared = reference.get(id);

      if (!compared) {
        make(entry, 'orphan-message', undefined, `${quoted(source)} has no message ${quoted(id)}, so nothing this message renders is compared with it.`);
        continue;
      }

      if (names && compared.names) compare(source, compared.names, entry, names, modifiers, make);
    }
  }

  return findings.sort(order);
};

const order = (a: CatalogueFinding, b: CatalogueFinding) => a.entry - b.entry || a.start - b.start;

const compare = (source: string, reference: Names, entry: number, names: Names, modifiers: Modifiers, make: (entry: number, code: Code, section: string | undefined, message: string, start?: number, end?: number) => void) => {
  for (const name of reference.keys()) {
    if (!names.has(name)) make(entry, 'parameter-mismatch', '9.2', `This message never reads ${quoted(name)}, which the ${quoted(source)} message reads.`);
  }

  const selecting = (placeholders: Placeholder[], selections: readonly string[]) => placeholders
    .filter((placeholder) => selections.includes(selectionOf(placeholder, modifiers) ?? ''));
  const showing = (placeholders: Placeholder[]) => new Set(placeholders.flatMap((placeholder) => shownWith(placeholder, modifiers) ?? []));

  for (const [name, placeholders] of names) {
    const [first] = placeholders;
    const compared = reference.get(name);

    if (!compared) {
      make(entry, 'parameter-mismatch', '9.2', `${quoted(name)} is read here and never in the ${quoted(source)} message, so a payload written for that message does not carry it.`, first.node.start, first.node.end);
      continue;
    }

    const shown = showing(placeholders);
    const reshown = showing(compared);
    const differs = [...shown].some((how) => !reshown.has(how)) || [...reshown].some((how) => !shown.has(how));

    // A message that only selects by a parameter shows it no other way.
    if (shown.size && reshown.size && differs) {
      const spell = (hows: Set<string>) => [...hows].map((how) => (how ? `with ${quoted(how)}` : 'as it is')).join(' and ');

      make(entry, 'modifier-mismatch', '11', `${quoted(name)} is shown ${spell(shown)} here and ${spell(reshown)} in the ${quoted(source)} message.`, first.node.start, first.node.end);
    }

    const selections = selecting(placeholders, PLURALS);

    if (!selections.length) continue;

    // Text of its own for a number, given by the plural selection or by one
    // that compares the value with the number's key.
    const keyed = new Set([...numbersOf(selections, false), ...numbersOf(selecting(placeholders, ['eq']), true)]);
    const at = selections[0].modifier ?? selections[0].node;

    for (const number of new Set(numbersOf(selecting(compared, PLURALS), false))) {
      if (keyed.has(number)) continue;

      make(entry, 'missing-number-key', '11.5', `The ${quoted(source)} message gives ${quoted(String(number))} text of its own, and this selection has no ${quoted(String(number))} option, so it takes its category's.`, at.start, at.end);
    }
  }
};

/** Lints a catalogue: a tree of messages for each locale. */
export const lintCatalogue = (catalogue: Catalogue, options: CatalogueOptions = {}): CatalogueFinding[] => {
  const locales = own(catalogue);
  const entries: Entry[] = [];
  // The last message read of each locale whose tree holds more.
  const cut: number[] = [];

  for (const [locale, tree] of locales) {
    const walked = walk(tree);

    for (const { id, message } of walked.messages) entries.push({ locale, id, message });
    if (walked.cut) cut.push(entries.length - 1);
  }

  const findings = lintEntries(entries, { ...options, locales: locales.map(([locale]) => locale) });

  for (const entry of cut) {
    const { locale, id } = entries[entry];
    const message = `${quoted(locale)} holds more than ${MAX_MESSAGES} messages, an object it holds in several places counted in each, so it is read no further than this one.`;

    findings.push({ ...finding('unreadable-catalogue', undefined, message, 0, 0), locale, id, entry });
  }

  return findings.sort(order);
};
