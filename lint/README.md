# @curly-message/lint

A linter for the [Curly Message Format](https://github.com/curly-message/spec).
Nothing in the format fails loudly: a placeholder that never closes is text, a
modifier nobody registered takes the fallback chain, a plural category nobody
wrote an option for renders whatever the chain holds. Every one of them renders
something, and a reader of the rendered string cannot tell it from what was
meant. This package finds them in the text, before anything renders.

Every rule is decidable from a message alone, from a message and its locale, or
from a catalogue of messages in several locales. None needs a payload: what a
payload decides is what the parser reports while it resolves.

## Installation

```bash
npm install --save-dev @curly-message/lint @curly-message/parser
```

The parser is a peer dependency: the linter reads a message with the parser
the project resolves it with, so the two agree on what a placeholder is.

## The command line

```bash
npx curly-lint "locales/{locale}/{namespace}.json"
```

`curly-lint` lints the JSON catalogues a pattern names, and reads each file's
locale and namespace off its path where the pattern places them:
`locales/cs/common.json` holds Czech messages whose ids sit under `common`, and
`locales/cs/admin/users.json` holds Czech ones under `admin.users`. All a run
reads is one catalogue, each id compared across the locales found in it, so
lint another app's catalogue in a run of its own.

- `{locale}` stands for a locale tag within one name of the path, with text
  around it where the pattern writes some, as in
  `"i18n/messages.{locale}.json"`. A tag is one whose language has two or three
  letters, such as `cs`, `en-US` or `pt_BR`, read as `pt-BR`. A file whose path
  holds no tag there, such as `locales/glossary.json`, is not one the pattern
  names.
- `{namespace}` stands for one name or more, joined with dots:
  `"locales/{namespace}/{locale}.json"` reads `locales/admin/users/cs.json` as
  Czech messages under `admin.users`. Where a pattern has none, a file's ids sit
  under no namespace.
- Each is there once at most, and both share a name only where the pattern
  parts them with a character no tag holds, such as `.`:
  `"i18n/{namespace}.{locale}.json"`.
- The pattern names `.json` files, and the directory before its first
  placeholder is searched for them. `/` and `\` both part names.
- No placeholder reads a name that starts with a dot, nor `node_modules`: the
  pattern reads one only where it writes that dot or that name, as in
  `"packages/{namespace}/.i18n/{locale}.json"`.
- Links are followed, but not one to a directory that holds it, nor one to
  the directory searched or a directory above it.
- A file is read once for each locale it has, at one of its paths, its ids
  under the namespace that path places: the first pattern's path to it, of
  those the one through the fewest links, and of those the first in the order
  of paths. A link `locales/pt` to `locales/pt-BR` reads a file as `pt` and as
  `pt-BR`; a link `locales/en/app.json` to `common.json` beside it reads that
  file under `common` alone.

Quote a pattern, as PowerShell and some shells read its braces otherwise. In a
`package.json` script, escape the quotes:
`"lint:messages": "curly-lint \"locales/{locale}/{namespace}.json\""`.

A file or a directory given as it is, searched for `.json` files, holds no
locale and no namespace: its messages are linted one by one, compared with no
other locale's, and the command says how many files it read without a locale.
Below such a directory, no name that starts with a dot and no `node_modules` is
read, and links are followed as below a pattern's. A file a pattern reads is
read as the pattern places it, whichever argument comes first.
`--locale` names the locale of every file whose path holds none, so
`curly-lint "locales/en/{namespace}.json" --locale en` lints the English
catalogue alone, under its namespaces.

```
locales/cs/common.json:2:9  error  This message never reads `name`, which the `en` message reads.  parameter-mismatch
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category

2 problems (2 errors, 0 warnings)
```

| Option | Meaning |
| --- | --- |
| `--locale <tag>` | The locale of every file whose path holds none. |
| `--source <tag>` | The locale the others are compared with: `en` where the catalogue holds it, and otherwise the first locale found, reading the arguments in their order and the files of each in the order of their paths. |
| `--modifier <name>` | A modifier the host registers. Repeat it for each. |
| `--no-intl` | The host satisfies Core alone, not Intl: the six modifiers Intl defines are unknown unless `--modifier` names them. |
| `--format <format>` | `text`, the default, or `json`. |
| `--quiet` | Report errors only. |

A file that is not JSON is an [`unreadable-catalogue`](#unreadable-catalogue)
error at the place its reading stops, and so is one nested deeper than 512
levels. The command exits 1 where it finds an error, 2 where its arguments are
wrong, a path cannot be read or a pattern names no file, and 0 otherwise.

## The library

```js
import { lintMessage, lintCatalogue } from '@curly-message/lint';

lintMessage('{{n:plural; one:soubor; few:soubory; other:souborů;}}', { locale: 'cs' });
// [{ code: 'missing-category', severity: 'error', section: '11.5', start: 4, end: 10,
//    message: '`cs` puts 0.5, 1.5 and 2.5 in `many`, …' }]

lintCatalogue({
  en: { hi: 'Hello, {{name}}!' },
  cs: { hi: 'Ahoj, {{jmeno}}!' },
});
// two `parameter-mismatch` findings on the `cs` message, `{ locale: 'cs', id: 'hi', … }`
```

| Export | What it does |
| --- | --- |
| `lintMessage(message, options?)` | Lints one message. `options.locale` adds the rules a locale decides, written with `-` or `_`; `options.modifiers` names the modifiers a host registers; `options.intl: false` is a host that satisfies Core alone. |
| `lintCatalogue(catalogue, options?)` | Lints a tree of messages for each locale: each message with its locale, then every locale against the source one. `options.source` names it. |
| `lintEntries(entries, options?)` | The same over a list of `{ locale, id, message }`. A finding's `entry` is the index of its message in the list. `options.locales` names the locales the catalogue is written for, so one with no message yet lacks every message of the source locale. |
| `entriesOf(catalogue)`, `flatten(tree)` | The messages a catalogue or a tree holds, in order, each string leaf by its path joined with dots, up to a million for each tree. Only an object's own enumerable data members are read, so no accessor runs, and an object a tree holds inside itself is read where it is first reached. |
| `readCatalogue(text)` | Reads a JSON catalogue as `JSON.parse` does, past a byte order mark and up to 512 levels deep, and says where each string stands in the text, past its escape sequences, and which members a later one of the same name replaced. |
| `RULES` | Every rule: its code, severity, scope and the section of the specification it rests on. |

A finding carries its `code`, its `severity`, an English `message` saying
what is wrong and what happens instead, the `section` of the specification it
rests on where one does, and `start` and `end`, a range of UTF-16 code units in
the message. A finding in a catalogue also names its message's `locale` and
`id`. One about a whole message — one a catalogue has and another lacks, or
one defined twice — spans nothing, from 0 to 0.

## Rules

An error is text that renders other than its author meant, or a message the
parser reports while it resolves. A warning is text that renders as written but
can never be reached, or is easy to misread.

### A message

#### `unclosed-placeholder`

Error. A `{{` that opens no placeholder renders as text: nothing closes it on
its line, or what it encloses is not a placeholder (section 6).

#### `unknown-modifier`

Error. A modifier the format does not define and the host does not register
takes the fallback chain and is reported, and is never run as `eq` (section
11.4). A host that satisfies Core alone does not have the modifiers Intl
defines — `number`, `date`, `ago`, `currency`, `plural` and `ordinal` — so
for such a host, which `intl: false` or `--no-intl` names, those are unknown
as well, unless it registers them (section 2).

#### `missing-options`

Error. A comparison or a plural selection that declares no options has nothing
to select from (section 9.5). `{{n:number}}` selects nothing and is complete.

#### `nesting-limit`

Error. A placeholder written more than eight levels deep is never resolved
(section 13), so no other rule reads it or what it holds.

#### `default-case`

Error. Only `default` in lower case is the inline default. `DEFAULT:` is an
option like any other, so a placeholder with no `default:` beside it has no
inline default at all (section 9.3). Beside one, `Default:` is how `eq`
selects for the value `default`, and is not reported.

#### `duplicate-option`

Warning. An option an earlier one selects in place of: `A` after `a` under
`eq`, `2.0` after `2` under `lt` or `plural`, a category written twice, or a
second `default` (sections 9.3, 11.1 and 11.5).

#### `unreachable-option`

Warning. An option its modifier never selects: a key that is not a number under
`lt` or `gt`, `-Infinity` under `lt` and `Infinity` under `gt`, an option
after two keys that differ under `ne`, which selects one of them whatever the
value, a fraction under `ordinal`, any option of a formatting modifier
(sections 9.5, 11.1 and 11.5).

#### `unknown-category`

Error. A key of a plural selection that is neither one of the six categories
nor a number never selects. Categories are compared exactly as written, so
`One` is neither (section 11.5).

#### `inert-escape`

Warning. A backslash before a character with no structural meaning cancels
nothing, so both characters render. `\\d` says so on purpose (section 7).

#### `bare-count`

Warning. `{{n}}` beside `{{n:plural; …}}` shows the value as written, while
`plural` selects by the number `number` would show, and the two part over
`1.0` or `1.999`. `{{n:number}}` agrees with it (section 11.5).

### A message and its locale

#### `unused-category`

Warning. A category the locale never answers is unreachable text. `zero:` in
English is the usual one, and `0:` is what selects for zero in every locale
(section 11.5).

#### `missing-category`

Error. A category the locale answers that the selection has no option for
takes the fallback chain: Czech `many`, which only a number shown with a
fraction reaches, is the usual one. Number keys for some of the category's
counts, its whole numbers from 0, leave the others to the chain (section
11.5).

#### `keyed-category`

Warning. A category with no option, every count of which has a number key:
`1:` and no `one:` in English. A number key selects for its value alone, so
what the category holds besides its counts takes the fallback chain: -1, and
1.001, which `plural` shows as `1`. A count is seldom either, which is why it
is a warning (section 11.5).

Which categories a locale has is the host's locale data: these findings are
made against the plural rules of the runtime the linter runs on.

### A catalogue

#### `unreadable-catalogue`

Error. A catalogue the linter cannot read in full: a file that is not JSON,
or is nested deeper than 512 levels, reported where its reading stops, and a
tree handed to `lintCatalogue` that holds more than a million messages — an
object it holds in several places counted in each — reported on the last
message read. What a file that is not JSON holds is unknown, so `curly-lint`
compares no message under its namespace, in any locale: each is linted alone.

#### `duplicate-id`

Error. An id defined twice in one locale — a member a later one of the same
name replaces, or a dotted key and a nested one that join to one id — so one
of the two messages is never read.

#### `missing-message`

Warning. A message the source locale has and another locale lacks.

#### `orphan-message`

Warning. A message the source locale lacks, which nothing compares.

#### `parameter-mismatch`

Error. A message that never reads a parameter the source locale's reads, or
reads one it never does, so a payload written for one is wrong for the other
(section 9.2).

#### `modifier-mismatch`

Warning. A parameter shown with another modifier than in the source locale:
`{{at:date}}` there and `{{at}}` here. Selecting by it another way, or only
selecting by it, is translation and is not reported (section 11).

#### `missing-number-key`

Warning. A number key the source locale's plural selection has and another
locale's lacks: `0:no files` in English and no `0:` in Czech, so zero takes
the `other` form in Czech alone. A selection around the plural one that keys
`0` gives zero its own text as well. A language may have no need for the
special case, which is why it is a warning (section 11.5).

## License

[MIT](./LICENSE)
