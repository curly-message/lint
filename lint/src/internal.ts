// What the fixture set at the repository's root reaches that the package does
// not export: the rules handed a host's plural rules, and the findings a file
// yields as it is read. The build writes it beside the package's entry, and
// the package's `exports` leave it out.
export { lintEntriesWith } from './catalogue';
export { lintMessageWith } from './message';
export { readFindings } from './read';
export type { Plurals, Rules } from './plural';
