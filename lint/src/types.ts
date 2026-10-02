/**
 * What a finding is about. Each code is one rule, and every rule is decidable
 * from the text of a message, or of a catalogue, without a payload.
 */
export type Code =
  // A message, read alone.
  | 'unclosed-placeholder'
  | 'unknown-modifier'
  | 'missing-options'
  | 'nesting-limit'
  | 'default-case'
  | 'duplicate-option'
  | 'unreachable-option'
  | 'unknown-category'
  | 'inert-escape'
  | 'bare-count'
  // A message, read with its locale.
  | 'unused-category'
  | 'missing-category'
  | 'keyed-category'
  // A catalogue: one locale, or one compared with another.
  | 'unreadable-catalogue'
  | 'duplicate-id'
  | 'missing-message'
  | 'orphan-message'
  | 'parameter-mismatch'
  | 'modifier-mismatch'
  | 'missing-number-key';

/**
 * An error is text that renders other than its author meant, or a message the
 * format reports at resolution. A warning is text that renders as written but
 * is unreachable or easy to misread.
 */
export type Severity = 'error' | 'warning';

/** One problem in a message, located by UTF-16 code units of its text. */
export type Finding = {
  code: Code;
  severity: Severity;
  /** What is wrong and what happens instead, in English. */
  message: string;
  /** The section of the specification the rule rests on, where one does. */
  section?: string;
  start: number;
  end: number;
};

/**
 * A finding in a catalogue: the message it is in, by locale and id, and by
 * `entry`, the index of that message in the list the catalogue was read as.
 */
export type CatalogueFinding = Finding & {
  locale: string;
  id: string;
  entry: number;
};

export type Options = {
  /**
   * The names of the modifiers a host registers (section 11.3). A name the
   * format defines is then the host's, and is read as the host's modifier.
   */
  modifiers?: readonly string[];
  /**
   * Whether the host satisfies the Intl level (section 2), as it does where
   * this is not `false`. A host that satisfies Core alone lacks the six
   * modifiers Intl defines, and reads each as an unknown modifier unless it
   * registers one of that name.
   */
  intl?: boolean;
};

export type MessageOptions = Options & {
  /** The locale the message is written for, which the plural rules read. */
  locale?: string;
};

export type CatalogueOptions = Options & {
  /**
   * The locale every other is compared with. Where none is named, `en` is
   * where the catalogue holds it, and otherwise the first locale.
   */
  source?: string;
};

export type EntriesOptions = CatalogueOptions & {
  /**
   * The locales the catalogue is written for, a locale with no message among
   * them, which lacks every message of the source locale.
   */
  locales?: readonly string[];
};

/** A catalogue: a tree of messages for each locale. */
export type Catalogue = Record<string, unknown>;
