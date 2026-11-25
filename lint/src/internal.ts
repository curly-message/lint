// What the fixture set at the repository's root reaches that the package does
// not export: the rules handed a host's plural rules, the findings a file
// yields as it is read, the table of rules the core holds, and how much a
// batch of entries holds. The build
// writes it beside the package's entry, and the package's `exports` leave it
// out.
export { lintEntriesWith } from './catalogue';
export { BATCH, ENTRY, held, KEPT, lintMessageWith, rulesOfCore } from './core';
export { readFindings } from './read';
export type { Plurals, Rules } from './plural';
