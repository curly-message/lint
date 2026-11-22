import { localeKey } from './tag';

/** The plural categories of the Unicode CLDR, which section 11.5 keys by. */
export const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export type Category = typeof CATEGORIES[number];

export const isCategory = (key: string): key is Category => (CATEGORIES as readonly string[]).includes(key);

// Whitespace in section 6's class, for the test below: text that is only
// padding is no number, whatever the host's conversion makes of it.
const BLANK = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/;

/**
 * The number a key reads as by section 11.2's test, which section 11.5
 * applies to a key's own text: the host's numeric conversion, finite, and
 * never of text that is only padding.
 */
export const numberOf = (key: string): number | undefined => {
  if (BLANK.test(key)) return undefined;

  const value = Number(key);

  return Number.isFinite(value) ? value : undefined;
};

export type RuleType = Intl.PluralRuleType;

// Numbers a category is shown with, found by asking the host: the integers
// first, then numbers shown with a fraction, which only some categories take,
// their negations, and numbers `plural` shows as an integer, which a number
// key equal to that integer does not select.
const SHOWN = [
  ...Array.from({ length: 200 }, (_, index) => index + 1),
  1000, 10000, 100000, 1000000,
  ...Array.from({ length: 21 }, (_, index) => index + 0.5),
];

const ROUNDED = Array.from({ length: 21 }, (_, index) => index + 0.001);

const PROBES = [0, ...SHOWN, ...SHOWN.map((number) => -number), ...ROUNDED, ...ROUNDED.map((number) => -number)];

const supported = (locale: string) => {
  try {
    return Intl.PluralRules.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
};

/** A locale's plural rules of one type: the categories they answer, and the one a number takes. */
export type Rules = { categories: readonly Category[], select: (number: number) => Category };

/**
 * The plural rules a host has for a locale, asked by its key (`localeKey`),
 * and none where it has no rules for it.
 */
export type Plurals = (tag: string, type: RuleType) => Rules | undefined;

/** The rules of the host's `Intl.PluralRules`. */
export const intlPlurals: Plurals = (tag, type) => {
  if (!supported(tag)) return undefined;

  // `plural` shows at most two fraction digits by default, and selects by
  // what it shows (section 11.5).
  const rules = new Intl.PluralRules(tag, type === 'cardinal' ? { type, maximumFractionDigits: 2 } : { type });

  return { categories: rules.resolvedOptions().pluralCategories, select: (number) => rules.select(number) };
};

export type Categories = Map<Category, number[]>;

const known = new WeakMap<Plurals, Map<string, Categories | undefined>>();

/**
 * The categories a locale's rules answer, each with the numbers among a set
 * of probes it puts in it, or nothing where the host has no rules for the
 * locale. A locale may be written with `_`, as a path or a POSIX locale
 * writes it, for `-`.
 */
export const categoriesOf = (locale: string, type: RuleType, plurals: Plurals): Categories | undefined => {
  const tag = localeKey(locale);
  const cached = `${type} ${tag}`;
  let asked = known.get(plurals);

  if (!asked) {
    asked = new Map();
    known.set(plurals, asked);
  }

  if (asked.has(cached)) return asked.get(cached);

  const rules = plurals(tag, type);
  let answer: Categories | undefined;

  if (rules) {
    answer = new Map(rules.categories.map((category) => [category, []]));

    for (const probe of PROBES) {
      if (type === 'ordinal' && !Number.isInteger(probe)) continue;

      answer.get(rules.select(probe))?.push(probe);
    }
  }

  asked.set(cached, answer);

  return answer;
};
