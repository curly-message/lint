import type * as Shipped from '@curly-message/lint';
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
  Assert<Equal<typeof Shipped.entriesOf, typeof Source.entriesOf>>,
  Assert<Equal<typeof Shipped.flatten, typeof Source.flatten>>,
  Assert<Equal<typeof Shipped.lintCatalogue, typeof Source.lintCatalogue>>,
  Assert<Equal<typeof Shipped.lintEntries, typeof Source.lintEntries>>,
  Assert<Equal<typeof Shipped.lintMessage, typeof Source.lintMessage>>,
  Assert<Equal<typeof Shipped.readCatalogue, typeof Source.readCatalogue>>,
  Assert<Equal<typeof Shipped.RULES, typeof Source.RULES>>,
  Assert<Equal<Shipped.Catalogue, Source.Catalogue>>,
  Assert<Equal<Shipped.CatalogueFinding, Source.CatalogueFinding>>,
  Assert<Equal<Shipped.CatalogueOptions, Source.CatalogueOptions>>,
  Assert<Equal<Shipped.Code, Source.Code>>,
  Assert<Equal<Shipped.EntriesOptions, Source.EntriesOptions>>,
  Assert<Equal<Shipped.Entry, Source.Entry>>,
  Assert<Equal<Shipped.Finding, Source.Finding>>,
  Assert<Equal<Shipped.Located, Source.Located>>,
  Assert<Equal<Shipped.MessageOptions, Source.MessageOptions>>,
  Assert<Equal<Shipped.Options, Source.Options>>,
  Assert<Equal<Shipped.Read, Source.Read>>,
  Assert<Equal<Shipped.Replaced, Source.Replaced>>,
  Assert<Equal<Shipped.Rule, Source.Rule>>,
  Assert<Equal<Shipped.Scope, Source.Scope>>,
  Assert<Equal<Shipped.Severity, Source.Severity>>,
];
