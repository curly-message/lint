import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCatalogue, RULES } from '@curly-message/lint';
import type { EntriesOptions, Entry, MessageOptions } from '@curly-message/lint';
import { lintEntriesWith, lintMessageWith, readFindings } from '#internal';
import type { Plurals, Rules } from '#internal';

// The fixture set at the repository's root, which every implementation of
// the linter runs: each case through the package, with the plural rules the
// case names in place of the host's.
const root = new URL('../../fixtures/', import.meta.url);

type Category = Rules['categories'][number];

type Table = Record<string, Partial<Record<'cardinal' | 'ordinal', { categories: Category[], select: Partial<Record<Category, number[]>> }>>>;

type Expected = { code: string, severity: string, section?: string, message: string, start: number, end: number, entry?: number };

type Case =
  | { name: string, message: string, options?: MessageOptions, plurals?: Table, findings: Expected[] }
  | { name: string, entries: Entry[], options?: EntriesOptions, plurals?: Table, findings: Expected[] }
  | { name: string, text: string, strings: { path: string[], value: string, start: number, end: number, offsets?: number[] }[], findings: Expected[] };

type File = { kind: 'message' | 'entries' | 'read', description: string, cases: Case[] };

const read = (path: URL) => JSON.parse(readFileSync(path, 'utf8')) as unknown;

const codes: string[] = (read(new URL('schema.json', root)) as { $defs: { code: { enum: string[] } } }).$defs.code.enum;

// By entry, start, end, the code's place in the schema's list, then the text
// by UTF-16 code units.
const inOrder = (a: Expected, b: Expected) => (a.entry ?? 0) - (b.entry ?? 0) || a.start - b.start || a.end - b.end || codes.indexOf(a.code) - codes.indexOf(b.code) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0);

const files = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap(({ name: kind }) => readdirSync(new URL(`${kind}/`, root)).filter((name) => name.endsWith('.json')).sort().map((name) => ({ name: `${kind}/${name}`, kind, file: read(new URL(`${kind}/${name}`, root)) as File })));

// The host the case names: the rules of each locale and type it lists, and
// none for any other.
const hostOf = (table: Table = {}): Plurals => (tag, type) => {
  const rules = Object.hasOwn(table, tag) ? table[tag][type] : undefined;

  if (!rules) return undefined;

  const taken = new Map(Object.entries(rules.select).flatMap(([category, numbers]) => (numbers ?? []).map((number) => [number, category as Category])));

  return { categories: rules.categories, select: (number) => taken.get(number) ?? 'other' };
};

describe('the fixture set', () => {
  it('holds a file of each kind, each in the directory of its kind', () => {
    expect(new Set(files.map(({ kind }) => kind))).toEqual(new Set(['message', 'entries', 'read']));
    expect(files.filter(({ kind, file }) => file.kind !== kind).map(({ name }) => name)).toEqual([]);
  });

  it('lists the codes in the order of `RULES`', () => {
    expect(codes).toEqual(RULES.map(({ code }) => code));
  });

  it('validates against its schema', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(read(new URL('schema.json', root)) as object);
    const invalid = files.filter(({ file }) => !validate(file)).map(({ name }) => ({ name, errors: validate.errors }));

    expect(invalid).toEqual([]);
  });

  it('states each set of plural rules one way only', () => {
    for (const { name, file } of files) {
      for (const c of file.cases) {
        for (const [tag, types] of Object.entries('plurals' in c ? c.plurals ?? {} : {})) {
          for (const [type, { categories, select }] of Object.entries(types)) {
            const listed = Object.entries(select).flatMap(([, numbers]) => numbers ?? []);
            const where = `${name}, ${c.name}, ${tag} ${type}`;

            expect(Object.keys(select).filter((category) => !categories.includes(category as Category)), where).toEqual([]);
            expect(listed.filter((number, index) => listed.indexOf(number) !== index), where).toEqual([]);
          }
        }
      }
    }
  });

  it('lists the findings of each case in the order every implementation answers them in', () => {
    for (const { name, file } of files) {
      for (const c of file.cases) expect(c.findings, `${name}, ${c.name}`).toEqual([...c.findings].sort(inOrder));
    }
  });

  it('names each case once within its file', () => {
    for (const { file } of files) {
      const names = file.cases.map(({ name }) => name);

      expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    }
  });
});

for (const { name, kind, file } of files) {
  describe(name, () => {
    for (const c of file.cases) {
      it(c.name, () => {
        if (kind === 'message' && 'message' in c) {
          expect(lintMessageWith(hostOf(c.plurals))(c.message, c.options)).toEqual(c.findings);
        } else if (kind === 'entries' && 'entries' in c) {
          const found = lintEntriesWith(hostOf(c.plurals))(c.entries, c.options);

          // A finding names its message's locale and id as the entry does.
          expect(found.map(({ locale, id, ...rest }) => ({ ...rest, at: [locale, id] }))).toEqual(c.findings.map((expected) => ({ ...expected, at: [c.entries[expected.entry!].locale, c.entries[expected.entry!].id] })));
        } else if (kind === 'read' && 'text' in c) {
          const result = readCatalogue(c.text);
          const strings = result.ok ? result.strings : [];

          expect(strings.map(({ path, value, start, end }) => ({ path, value, start, end }))).toEqual(c.strings.map(({ path, value, start, end }) => ({ path, value, start, end })));
          c.strings.forEach(({ offsets }, index) => {
            if (offsets) expect(Array.from({ length: offsets.length }, (_, unit) => strings[index].offsetOf(unit))).toEqual(offsets);
            if (offsets) expect(offsets).toHaveLength(strings[index].value.length + 1);
          });
          expect(readFindings(result)).toEqual(c.findings);
        } else {
          throw new Error(`A case of a ${kind} file reads as another kind.`);
        }
      });
    }
  });
}
