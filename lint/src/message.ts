import { categoriesOf, CATEGORIES, isCategory, numberOf } from './plural';
import type { RuleType } from './plural';
import { read } from './tree';
import type { Placeholder, Segment, Tree } from './tree';
import { SEVERITY } from './rules';
import type { Code, Finding, MessageOptions } from './types';

/** The modifiers section 11 defines, which a host may replace by name. */
export const BUILT_IN = ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'number', 'date', 'ago', 'currency', 'plural', 'ordinal'];

/** Those the Intl level defines, which a host that satisfies Core alone lacks (section 2). */
export const INTL = ['number', 'date', 'ago', 'currency', 'plural', 'ordinal'];

/** The modifiers of the format's own a host has: all, or Core's alone (section 2). */
export const definedBy = (intl: boolean | undefined) => (intl === false ? BUILT_IN.filter((name) => !INTL.includes(name)) : BUILT_IN);

const SELECTIONS = ['eq', 'ne', 'lt', 'gt', 'lte', 'gte', 'plural', 'ordinal'];

export const FORMATTING = ['number', 'date', 'ago', 'currency'];

// How deep resolution goes (section 13): a placeholder written deeper is
// never resolved.
const MAX_NESTING = 8;

/** The placeholders written no deeper than resolution goes. */
export const resolvable = (tree: Tree) => tree.placeholders.filter(({ depth }) => depth <= MAX_NESTING);

export const finding = (code: Code, section: string | undefined, message: string, start: number, end: number): Finding => ({ code, severity: SEVERITY[code], message, ...(section ? { section } : {}), start, end });

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

const CLOSE = /\}\}/g;

export const quoted = (text: string) => `\`${text}\``;

const list = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** What answers to a placeholder's modifier name, and how. */
type Reading = { name: string, own: boolean };

export const readingOf = (placeholder: Placeholder, defined: readonly string[], hosted: readonly string[]): Reading | undefined => {
  const options = placeholder.segments.some(({ name }) => name !== 'default');
  // No modifier and no options is a plain substitution; options alone are
  // `eq`'s (section 9.5).
  const name = placeholder.modifier?.name ?? (options ? 'eq' : undefined);

  if (name === undefined) return undefined;

  return { name, own: defined.includes(name) && !hosted.includes(name) };
};

// What an option key selects for under a modifier: two keys alike select
// alike, so the later one is never reached (sections 11.1 and 11.5). A key
// that compares with nothing has none.
const identity = (modifier: string, key: string) => {
  if (modifier === 'lt' || modifier === 'gt') return Number.isNaN(Number(key)) ? undefined : `${Number(key)}`;

  if (modifier === 'plural' || modifier === 'ordinal') {
    if (isCategory(key)) return key;

    const number = numberOf(key);

    return number === undefined ? undefined : `${number}`;
  }

  return key.toLowerCase();
};

// The first match of a pattern at or after an offset, for offsets that only
// grow: the pattern crosses the text once, however often it is asked.
const ahead = (text: string, pattern: RegExp) => {
  let found = -1;

  return (from: number) => {
    if (found >= from) return found;

    pattern.lastIndex = from;
    found = pattern.exec(text)?.index ?? Infinity;

    return found;
  };
};

const spelling = (message: string, { start, end }: { start: number, end: number }) => quoted(message.slice(start, end));

/**
 * Lints one message: everything its text decides, and, given its locale, what
 * the locale's plural rules decide as well.
 */
export const lintMessage = (message: string, options: MessageOptions = {}): Finding[] => lintTree(message, read(message), options);

/** Lints a message `read` has read, or found too deep to read. */
export const lintTree = (message: string, tree: Tree | undefined, options: MessageOptions = {}): Finding[] => {
  if (!tree) {
    return [finding('nesting-limit', '13', `This message nests placeholders deeper than can be read here, far past the ${MAX_NESTING} levels resolution goes, so each placeholder past them takes its fallback chain.`, 0, message.length)];
  }

  const hosted = options.modifiers ?? [];
  const defined = definedBy(options.intl);
  const placeholders = resolvable(tree);
  const findings: Finding[] = [];
  const add = (found: Finding) => { findings.push(found); };

  const lineEnd = ahead(message, LINE_TERMINATOR);
  const close = ahead(message, CLOSE);

  for (const text of tree.texts) {
    const spelled = message.slice(text.start, text.end);

    for (let index = spelled.indexOf('{{'); index !== -1; index = spelled.indexOf('{{', index + 2)) {
      const at = text.start + index;
      const why = close(at + 2) < lineEnd(at + 2) ? 'what it encloses is not a placeholder' : 'nothing closes it on its line';

      add(finding('unclosed-placeholder', '6', `\`{{\` opens no placeholder: ${why}, so it renders as text.`, at, at + 2));
    }
  }

  for (const escape of tree.escapes) {
    if (escape.cancels) continue;

    const spelled = message.slice(escape.start, escape.end);

    add(finding('inert-escape', '7', `${quoted(spelled)} cancels nothing, so the backslash and ${quoted(spelled.slice(1))} both render. Write ${quoted(`\\${spelled}`)} to keep both on purpose.`, escape.start, escape.end));
  }

  // The keys the format's own `plural` selects on, for `bare-count`.
  const counted = new Set<string>();

  for (const { node, depth } of tree.placeholders) {
    if (depth !== MAX_NESTING + 1) continue;

    add(finding('nesting-limit', '13', `This placeholder is written ${depth} deep, past the ${MAX_NESTING} levels resolution goes, so it takes its fallback chain.`, node.start, node.end));
  }

  // Resolution never reaches what is written deeper, so nothing there is read.
  for (const placeholder of placeholders) {
    const { node, key, modifier, segments } = placeholder;
    const at = modifier ?? node;

    if (modifier && !defined.includes(modifier.name) && !hosted.includes(modifier.name)) {
      const what = INTL.includes(modifier.name)
        ? 'is a modifier of the Intl level, which the host does not satisfy, and the host does not register it'
        : 'is no modifier the format defines or the host registers';

      add(finding('unknown-modifier', '11.4', `${quoted(modifier.name)} ${what}, so the placeholder takes its fallback chain.`, modifier.start, modifier.end));
      continue;
    }

    const defaults = segments.filter(({ name }) => name === 'default');
    const choices = segments.filter(({ name }) => name !== 'default');

    for (const extra of defaults.slice(1)) {
      add(finding('duplicate-option', '9.3', 'Only the first `default` is the inline default, so this one is never read.', extra.start, extra.end));
    }

    // Beside an inline default, such an option is how `eq` selects for the
    // value `default`.
    for (const choice of defaults.length ? [] : choices) {
      if (choice.name.toLowerCase() !== 'default') continue;

      add(finding('default-case', '9.3', `${quoted(choice.name)} is an option, not the inline default: only \`default\` in lower case is, and this placeholder has none.`, choice.start, choice.end));
    }

    const reading = readingOf(placeholder, defined, hosted);

    if (!reading?.own) continue;

    if (key && !choices.length && SELECTIONS.includes(reading.name)) {
      add(finding('missing-options', '9.5', `${quoted(reading.name)} selects among options and this placeholder declares none, so it takes its fallback chain.`, at.start, at.end));
    }

    if (FORMATTING.includes(reading.name)) {
      for (const choice of choices) {
        add(finding('unreachable-option', '9.5', `${quoted(reading.name)} selects nothing, so this option is never read.`, choice.start, choice.end));
      }

      continue;
    }

    const section = reading.name === 'plural' || reading.name === 'ordinal' ? '11.5' : '11.1';
    const first = new Map<string, Segment>();

    for (const choice of choices) {
      const id = identity(reading.name, choice.name);
      const earlier = id === undefined ? undefined : first.get(id);

      if (earlier) {
        add(finding('duplicate-option', section, `${quoted(choice.name)} selects where ${quoted(earlier.name)} before it does, so this option is never selected.`, choice.start, choice.end));
      } else if (id !== undefined && reading.name === 'ne' && first.size === 2) {
        // A value differs from one of two keys, so `ne` selects one of the
        // first two options that differ, whatever the value.
        const [a, b] = [...first.values()].map(({ name }) => quoted(name));

        add(finding('unreachable-option', '11.1', `Every value differs from ${a} or ${b}, and \`ne\` selects the first option whose key differs, so this option is never selected.`, choice.start, choice.end));
      } else if (id !== undefined) {
        first.set(id, choice);
      }
    }

    if (reading.name === 'lt' || reading.name === 'gt') {
      const bound = reading.name === 'lt' ? -Infinity : Infinity;

      for (const choice of choices) {
        const number = Number(choice.name);

        if (Number.isNaN(number)) {
          add(finding('unreachable-option', '11.1', `${quoted(choice.name)} is not a number, and ${quoted(reading.name)} compares numerically, so this option is never selected.`, choice.start, choice.end));
        } else if (number === bound) {
          add(finding('unreachable-option', '11.1', `No value is ${reading.name === 'lt' ? 'less' : 'greater'} than ${quoted(choice.name)}, so this option is never selected.`, choice.start, choice.end));
        }
      }
    }

    if (reading.name === 'plural' || reading.name === 'ordinal') {
      if (key && reading.name === 'plural') counted.add(key.name);
      plurals(placeholder, reading.name, choices, options.locale, add);
    }
  }

  for (const { node, key, modifier, segments } of placeholders) {
    if (!key || modifier || segments.some(({ name }) => name !== 'default') || !counted.has(key.name)) continue;

    add(finding('bare-count', '11.5', `${spelling(message, node)} shows the value as it is written, while \`plural\` selects by the number \`number\` would show, and the two part over \`1.0\` or \`1.999\`. Write the count with \`:number\`.`, node.start, node.end));
  }

  return findings.sort((a, b) => a.start - b.start || a.end - b.end);
};

const plurals = (placeholder: Placeholder, modifier: string, choices: Segment[], locale: string | undefined, add: (found: Finding) => void) => {
  const type: RuleType = modifier === 'ordinal' ? 'ordinal' : 'cardinal';

  for (const choice of choices) {
    if (isCategory(choice.name)) continue;

    const number = numberOf(choice.name);

    if (number === undefined) {
      const lower = choice.name.toLowerCase();
      const meant = isCategory(lower) ? ` The category is ${quoted(lower)}, compared exactly as written.` : '';

      add(finding('unknown-category', '11.5', `${quoted(choice.name)} is neither a plural category nor a number, so this option is never selected.${meant}`, choice.start, choice.end));
    } else if (type === 'ordinal' && !Number.isInteger(number)) {
      add(finding('unreachable-option', '11.5', `\`ordinal\` takes integers, so ${quoted(choice.name)} is never selected.`, choice.start, choice.end));
    }
  }

  const categories = locale ? categoriesOf(locale, type) : undefined;

  if (!locale || !categories) return;

  for (const choice of choices) {
    if (!isCategory(choice.name) || categories.has(choice.name)) continue;

    const zero = choice.name === 'zero' ? ' Write `0:` to select for zero in every locale.' : '';

    add(finding('unused-category', '11.5', `${quoted(locale)} has no ${quoted(choice.name)} among its ${type} categories, so this option is never selected.${zero}`, choice.start, choice.end));
  }

  const at = placeholder.modifier ?? placeholder.node;
  // A number key selects for the value it equals alone, so the numbers it
  // takes out of a category are no example of what the category leaves.
  const keyed = new Set(choices.map(({ name }) => numberOf(name)));

  for (const category of CATEGORIES) {
    const numbers = categories.get(category) ?? [];
    const left = numbers.filter((number) => !keyed.has(number));

    if (!left.length || choices.some(({ name }) => name === category)) continue;

    const examples = list(left.slice(0, 3).map(String));
    const counts = numbers.filter((number) => number >= 0 && Number.isInteger(number));

    // Where every count has a key, what is left is what a count is seldom:
    // negative, or a fraction.
    if (counts.length && counts.every((number) => keyed.has(number))) {
      add(finding('keyed-category', '11.5', `Every count ${quoted(locale)} puts in ${quoted(category)} has a number key, but ${examples} fall there too, and this selection has no ${quoted(category)} option, so those take the fallback chain.`, at.start, at.end));
    } else {
      add(finding('missing-category', '11.5', `${quoted(locale)} puts ${examples} in ${quoted(category)}, and this selection has no ${quoted(category)} option, so those take the fallback chain.`, at.start, at.end));
    }
  }
};
