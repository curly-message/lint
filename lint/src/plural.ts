/** The plural categories of the Unicode CLDR, which section 11.5 keys by. */
export const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export type Category = typeof CATEGORIES[number];

export type RuleType = Intl.PluralRuleType;

/** A locale's plural rules of one type: the categories they answer, and the one a number takes. */
export type Rules = { categories: readonly Category[], select: (number: number) => Category };

/**
 * The plural rules a host has for a locale, asked by its tag in lower case
 * with `-` for `_`, and none where it has no rules for it. The core asks only
 * for a tag that is well-formed, as `Intl` takes one.
 */
export type Plurals = (tag: string, type: RuleType) => Rules | undefined;

/**
 * The rules of the host's `Intl.PluralRules`. What `Intl` throws is no
 * answer, and leaves as the core's `CoreError`.
 */
export const intlPlurals: Plurals = (tag, type) => {
  if (Intl.PluralRules.supportedLocalesOf([tag]).length === 0) return undefined;

  // `plural` shows at most two fraction digits by default, and selects by
  // what it shows (section 11.5).
  const rules = new Intl.PluralRules(tag, type === 'cardinal' ? { type, maximumFractionDigits: 2 } : { type });

  return { categories: rules.resolvedOptions().pluralCategories, select: (number) => rules.select(number) };
};
