import { failure, fromHost, lintEntriesIn, opened, unpaired } from './core';
import type { Entry, Opened } from './core';
import { intlPlurals } from './plural';
import type { Plurals } from './plural';
import { RANK, SEVERITY } from './rules';
import type { Catalogue, CatalogueFinding, CatalogueOptions, EntriesOptions } from './types';

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

const FIELDS = ['locale', 'id', 'message'] as const;

/**
 * A list of entries as the core is handed it, each entry read once: three
 * texts an entry, a locale or an id that is no string written as `String`
 * writes it; the locale and the id of each as the list holds them, which a
 * finding names; and the first entry whose locale, id or message is not
 * well-formed Unicode text, with which of the three and the surrogate in it
 * that pairs with no other. No entry past that one is read.
 */
type Listed = { texts: string[], named: unknown[], fault?: { index: number, field: typeof FIELDS[number], unit: string, locale: unknown, id: unknown } };

const listOf = (entries: Iterable<Entry>): Listed => {
  const texts: string[] = [];
  const named: unknown[] = [];
  let index = 0;

  for (const { locale, id, message } of entries) {
    const fields = { locale, id, message };

    for (const field of FIELDS) {
      const unit = unpaired(fields[field]);

      if (unit) return { texts, named, fault: { index, field, unit, locale, id } };
    }

    named.push(locale, id);
    texts.push(String(locale), String(id), typeof message === 'string' ? message : '');
    index += 1;
  }

  return { texts, named };
};

// A finding about a catalogue the core is never handed: text that is not
// well-formed Unicode, which it cannot hold, and the messages past a million,
// which are not read to hand it.
const unreadable = (locale: unknown, id: unknown, entry: number, message: string): CatalogueFinding => ({ code: 'unreadable-catalogue', severity: SEVERITY['unreadable-catalogue'], message, start: 0, end: 0, locale: locale as string, id: id as string, entry });

// Lints the entries up to the fault, where there is one. What the catalogue
// holds past it, or past the last entry where the catalogue was `cut`
// there, is unknown, so no message is then compared with another locale's,
// as `curly-lint` compares nothing a file that is not JSON holds.
const lintUpTo = ({ texts, named, fault }: Listed, given: Opened, plurals: Plurals, cut = false): CatalogueFinding[] => {
  const findings = lintEntriesIn(plurals, texts, named, given, cut || fault !== undefined);

  if (!fault) return findings;

  const { index, field, unit, locale, id } = fault;
  const shown = `U+${unit.charCodeAt(0).toString(16).toUpperCase()}`;

  return [...findings, unreadable(locale, id, index, `This entry's ${field} is not well-formed Unicode text: it holds the unpaired surrogate ${shown}, so the catalogue is read no further.`)];
};

/** Lints a list of messages as `lintEntries` does, with the plural rules `plurals` has. */
export const lintEntriesWith = (plurals: Plurals) => (entries: readonly Entry[], options: EntriesOptions = {}): CatalogueFinding[] => {
  try {
    // What the list and its options hold is read before the core is asked,
    // so that host code it runs never runs while the core holds the list.
    const [listed, given] = fromHost(() => [listOf(entries), opened(options, options.source, options.locales)] as const);

    return lintUpTo(listed, given, plurals);
  } catch (error) {
    throw failure(error);
  }
};

/**
 * Lints a list of messages as one catalogue: each message, each with its
 * locale, then every locale against the source one. A finding names its
 * message by `entry`, the index of the message in `entries`. The list is read
 * no further than an entry whose locale, id or message is not well-formed
 * Unicode text, which is an `unreadable-catalogue` finding, and no message is
 * then compared with another locale's.
 */
export const lintEntries = lintEntriesWith(intlPlurals);

// The order the core lists findings in: by entry, by place, by rule, then by
// the text's code units.
const order = (a: CatalogueFinding, b: CatalogueFinding) => a.entry - b.entry || a.start - b.start || a.end - b.end || RANK[a.code] - RANK[b.code] || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);

/**
 * Lints a catalogue: a tree of messages for each locale. A tree is read up to
 * a million messages. Where one holds more, no message is compared with
 * another locale's, and the last message read of it is an
 * `unreadable-catalogue` finding, unless the catalogue is read no further
 * than text before it that is not well-formed Unicode.
 */
export const lintCatalogue = (catalogue: Catalogue, options: CatalogueOptions = {}): CatalogueFinding[] => {
  try {
    const locales = own(catalogue);
    const entries: Entry[] = [];
    // The last message read of each locale whose tree holds more.
    const cut: number[] = [];

    for (const [locale, tree] of locales) {
      const walked = walk(tree);

      for (const { id, message } of walked.messages) entries.push({ locale, id, message });
      if (walked.cut) cut.push(entries.length - 1);
    }

    const given = fromHost(() => opened(options, options.source, locales.map(([locale]) => locale)));
    const listed = listOf(entries);
    const findings = lintUpTo(listed, given, intlPlurals, cut.length > 0);
    // No message past one that is not well-formed text is read.
    const read = listed.fault?.index ?? entries.length;

    // Each joins the core's findings, which come in order, at its own place.
    for (const entry of cut.filter((last) => last < read)) {
      const { locale, id } = entries[entry];
      const added = unreadable(locale, id, entry, `\`${locale}\` holds more than ${MAX_MESSAGES} messages, an object it holds in several places counted in each, so it is read no further than this one.`);
      const after = findings.findIndex((found) => order(added, found) < 0);

      findings.splice(after < 0 ? findings.length : after, 0, added);
    }

    return findings;
  } catch (error) {
    throw failure(error);
  }
};
