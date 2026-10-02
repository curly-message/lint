import type { Code, Severity } from './types';

/** Where a rule can be decided: a message alone, with its locale, or a catalogue. */
export type Scope = 'message' | 'locale' | 'catalogue';

export type Rule = {
  code: Code,
  severity: Severity,
  scope: Scope,
  /** The section of the specification the rule rests on, where one does. */
  section?: string,
  description: string,
};

/** Every rule, in the order the README lists them. */
export const RULES: readonly Rule[] = [
  { code: 'unclosed-placeholder', severity: 'error', scope: 'message', section: '6', description: 'A `{{` that opens no placeholder, and renders as text.' },
  { code: 'unknown-modifier', severity: 'error', scope: 'message', section: '11.4', description: 'A modifier neither the format defines nor the host registers.' },
  { code: 'missing-options', severity: 'error', scope: 'message', section: '9.5', description: 'A selection that declares no options.' },
  { code: 'nesting-limit', severity: 'error', scope: 'message', section: '13', description: 'A placeholder written deeper than resolution goes.' },
  { code: 'default-case', severity: 'error', scope: 'message', section: '9.3', description: 'An option keyed `default` in another case, which is no inline default.' },
  { code: 'duplicate-option', severity: 'warning', scope: 'message', section: '11.1', description: 'An option an earlier one selects in place of, or a second `default`.' },
  { code: 'unreachable-option', severity: 'warning', scope: 'message', section: '11.1', description: 'An option its modifier never selects.' },
  { code: 'unknown-category', severity: 'error', scope: 'message', section: '11.5', description: 'A key of a plural selection that is neither a category nor a number.' },
  { code: 'inert-escape', severity: 'warning', scope: 'message', section: '7', description: 'An escape sequence that cancels nothing.' },
  { code: 'bare-count', severity: 'warning', scope: 'message', section: '11.5', description: 'A count shown as written beside a `plural` that selects by the number shown.' },
  { code: 'unused-category', severity: 'warning', scope: 'locale', section: '11.5', description: 'A plural category the locale never answers.' },
  { code: 'missing-category', severity: 'error', scope: 'locale', section: '11.5', description: 'A plural category the locale answers and the selection has no option for.' },
  { code: 'keyed-category', severity: 'warning', scope: 'locale', section: '11.5', description: 'A plural category with no option, every count of which has a number key, so only negative numbers and fractions in it take the fallback chain.' },
  { code: 'unreadable-catalogue', severity: 'error', scope: 'catalogue', description: 'A catalogue read only up to where it is not JSON, nests past 512 levels or holds more than a million messages.' },
  { code: 'duplicate-id', severity: 'error', scope: 'catalogue', description: 'An id defined twice in one locale.' },
  { code: 'missing-message', severity: 'warning', scope: 'catalogue', description: 'A message the source locale has and another locale lacks.' },
  { code: 'orphan-message', severity: 'warning', scope: 'catalogue', description: 'A message the source locale lacks.' },
  { code: 'parameter-mismatch', severity: 'error', scope: 'catalogue', section: '9.2', description: 'A message that reads other parameters than the source locale\'s.' },
  { code: 'modifier-mismatch', severity: 'warning', scope: 'catalogue', section: '11', description: 'A parameter shown with another modifier than in the source locale.' },
  { code: 'missing-number-key', severity: 'warning', scope: 'catalogue', section: '11.5', description: 'A number key the source locale\'s selection has and another\'s lacks.' },
];

export const SEVERITY = Object.fromEntries(RULES.map(({ code, severity }) => [code, severity])) as Record<Code, Severity>;
