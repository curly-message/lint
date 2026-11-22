# The linter's fixture set

The contract of the linter: inputs, and the findings an implementation of the
linter answers for each, as data any language reads. Each file is JSON, holds
the cases of one kind, and validates against [`schema.json`](./schema.json).
The TypeScript linter runs every case in
[`lint/tests/fixtures.spec.ts`](../lint/tests/fixtures.spec.ts), against its
source and against its build. The Rust linter runs every case in
[`rust/tests/fixtures/`](../rust/tests/fixtures), its offsets converted from
UTF-16 code units to bytes.

| Directory | A case is | Reached in the TypeScript linter through |
|-----------|-----------|------------------------------------------|
| `message/` | a message and the options a host gives: `locale`, `modifiers`, `intl` | `lintMessage` |
| `entries/` | an ordered list of entries (`locale`, `id`, `message`) and options: `source`, `locales`, `modifiers`, `intl` | `lintEntries` |
| `read/` | the text of a catalogue file | `readCatalogue`, and the findings `curly-lint` reports for the file as it reads it |

A catalogue is stated as a list of entries or as the text of a file, never as
a parsed object: walking an object of the host is the host's, and is tested
where the host is.

## What a runner does

For every `*.json` file of the three directories, it validates the file
against the schema, then for each case:

- **`message`**: lints `message` with `options` (`intl` is `true` where it is
  absent) and answers exactly `findings`, in their order.
- **`entries`**: lints `entries` as one catalogue with `options`, and answers
  exactly `findings`, in their order. `entry` is the index in `entries` of the
  message a finding is in; where an implementation also reports a finding's
  locale and id, they are that entry's.
- **`read`**: reads `text` as a catalogue file, and answers exactly `strings`,
  every string the file holds, in its order, and `findings`: where the file
  stops being readable, with no string, or each member a later one of the
  same name replaces. Where a string lists `offsets`, the code unit at each
  index of its value is written at that offset of the text, past any escape
  sequence that spells it, and the index of the value's length answers the
  closing quote.

A finding is its rule's `code` and `severity`, the `section` of the
specification the rule rests on where it rests on one, its text, `message`,
and its span, `start` to `end`. A span of 0 to 0 is about the whole message.

Findings are answered in one order, which no two findings tie in: by `entry`,
where a case has entries; then by `start`; then by `end`; then by `code`, in
the order the schema's list of codes gives, which is the order the library's
`RULES` lists them in; then by `message`, comparing UTF-16 code units. A
runner checks that each case lists its findings in that order, and that the
linter answers them in it.

Every offset and span counts UTF-16 code units, of the message or of the
file's text. An implementation that counts otherwise converts at its edge.

A finding shows a character by its code point where Unicode gives it a
general category of Other (C) or Separator (Z), which each implementation
reads from the Unicode data its host has. So a case holds no character
Unicode assigned after the oldest version a supported host has, and none it
has not assigned, a noncharacter aside.

## Plural rules

A case consults no real host. Where it needs a locale's plural rules, it
names them in `plurals`, and the runner gives the linter those rules in place
of the host's:

- A locale is listed by its key: its tag with A-Z lowered and `_` read as
  `-`, as the linter tells one locale from another. A locale, or a type of
  rules (`cardinal`, `ordinal`), that is not listed is one the host has no
  rules for, and the linter then reads no plural rule of it.
- `categories` are the categories the rules answer, `other` always among
  them.
- `select` lists, for each category but `other`, the numbers the linter asks
  about that the rules put in it. A number listed under no category is put in
  `other`.

A table states each set of rules one way only: each category `select` lists
is one of `categories`, and no number is listed under two. The schema checks
that `other` is among `categories`; a runner rejects a case that breaks
either of the other two, which the schema cannot say.

The numbers the linter asks about, in the order a finding draws its examples
from: 0; 1 to 200; 1000, 10000, 100000 and 1000000; 0.5, 1.5 and on to 20.5;
the negation of each of those but 0, in the same order; 0.001, 1.001 and on
to 20.001; and their negations. Of these, ordinal rules are asked about the
integers alone. A cardinal rule is asked as `plural` reads a number, shown with
at most two fraction digits.

## Writing a case

Write a character outside ASCII as an escape. A case's `name` says what it
shows and is unique within its file. A case that the current linter answers
otherwise is a change of the linter: it lands with that change, in the same
pull request, and its `CHANGELOG.md` says what changed.
