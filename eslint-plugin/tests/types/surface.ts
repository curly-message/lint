import type * as Shipped from '@curly-message/eslint-plugin';
import type * as Source from '../../src/index';

// The declarations the build ships are the ones the source declares: an
// export the bundler dropped, widened to `any` or rewrote fails to compile
// here. TypeScript does not count two module namespaces identical even when
// every member is, so each export is compared on its own, and the value
// exports' names as a set. A new export joins the list: the set holds the
// values' names alone, so a type left out of the list goes unchecked.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export type Surface = [
  Assert<Equal<keyof typeof Shipped, keyof typeof Source>>,
  Assert<Equal<typeof Shipped.default, typeof Source.default>>,
  Assert<Equal<Shipped.Settings, Source.Settings>>,
];
