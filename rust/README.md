# curly-message-lint

[![crates.io](https://img.shields.io/crates/v/curly-message-lint)](https://crates.io/crates/curly-message-lint)
[![tests](https://github.com/curly-message/lint/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/curly-message/lint/actions/workflows/tests.yml)

The Rust implementation of the linter for the
[Curly Message Format](https://github.com/curly-message/spec): the rules of a
message, of a message with its locale and of a catalogue, a reader of JSON
catalogue files that says where each string stands, and the `curly-lint`
command as a native program.

```text
$ curly-lint "locales/{locale}/{namespace}.json"
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

[`@curly-message/lint`](../lint), the npm package, is this crate compiled to
WebAssembly, so it answers what the crate answers. Both run the cases of
[`fixtures/`](../fixtures), the linter's contract as data, and the command
takes the same arguments, writes the same report and exits with the same
codes.

## Install

```sh
cargo install curly-message-lint@1.0.0-next.0
```

installs the command, a prerelease being installed only by its version, and

```sh
cargo add curly-message-lint
```

adds the library. The crate needs Rust 1.88 or newer. It reads a message with
[`curly-message-parser`](https://github.com/curly-message/parsers/tree/main/rust),
so what it calls a placeholder is what resolution calls one. Each change is
tested on Rust 1.88 and on the current stable release, on Linux and Windows
with and without the `cldr` feature, on macOS with it, and built for
`wasm32-unknown-unknown` without it.

## The command line

```sh
curly-lint "locales/{locale}/{namespace}.json"
```

`curly-lint --help` prints the arguments, and the
[npm package's README](../lint/README.md#the-command-line) says how a
pattern reads a file's locale and namespace off its path, what the report
holds and what each exit code means. What differs here:

- **Plural rules are the crate's**, those of the Unicode CLDR 48, where the
  npm package's command asks the `Intl` of the runtime it runs on. A locale one
  knows and the other does not is linted with its rules by one and without
  them by the other: `bh` and `tw`, which the CLDR reads as `bho` and `ak`,
  have rules here and none in Node 22.
- **What the system says of a path that cannot be read** follows
  `Cannot read <path>:` in the system's words as Rust writes them, which are
  not Node's.
- **A file name that is not Unicode text** is read with U+FFFD in place of
  what is not, so the file is reported as one that cannot be read.
- **Which characters a report shows by code point**, as `U+0085`, follows the
  general categories of the Unicode version `unicode-properties` carries,
  Unicode 18.0 as the crate's lockfile resolves it, whatever version the
  system has. The npm package's command, compiled from the same lockfile,
  shows the same ones.

## The library

```rust
use curly_message_lint::{Cldr, EntriesOptions, Entry, Options, lint_entries, lint_message, read_catalogue};

let message = "{{n:plural; one:soubor; few:soubory; other:soubor\u{16f};}}";
let options = Options::default().locale("cs");
let findings = lint_message(message, &options, &Cldr);

// `cs` puts 0.5, 1.5 and 2.5 in `many`, ...
assert_eq!(findings[0].code.as_str(), "missing-category");
assert_eq!(findings[0].section, Some("11.5"));
assert_eq!((findings[0].start, findings[0].end), (4, 10));

let entry = |locale: &str, message: &str| Entry {
    locale: locale.to_owned(),
    id: "hi".to_owned(),
    message: message.to_owned(),
};
let entries = [entry("en", "Hello, {{name}}!"), entry("cs", "Ahoj, {{jmeno}}!")];
let findings = lint_entries(&entries, &EntriesOptions::default(), &Cldr);

// Two `parameter-mismatch` findings on the `cs` message.
assert!(findings.iter().all(|found| found.entry == 1));

let catalogue = read_catalogue("{\"hi\": \"Hello, {{name}}!\"}").expect("the text is JSON");

assert_eq!(catalogue.strings[0].path, ["hi"]);
assert_eq!((catalogue.strings[0].start, catalogue.strings[0].end), (7, 25));
```

| Item | What it does |
| --- | --- |
| `lint_message(message, options, plurals)` | Lints one message. `options.locale` adds the rules a locale decides, written with `-` or `_`; `options.modifiers` names the modifiers a host registers; `options.intl: false` is a host that satisfies Core alone. |
| `lint_entries(entries, options, plurals)` | Lints a list of `Entry { locale, id, message }` as one catalogue: each message with its locale, then every locale against the source one, which `options.source` names. Two tags that differ only in case, or in `_` for `-`, are one locale. A finding's `entry` is the index of its message in the list. `options.locales` names the locales the catalogue is written for, so one with no message yet lacks every message of the source locale. |
| `lint_entries_uncompared(entries, options, plurals)` | Lints a list as `lint_entries` does, but compares no locale with the source one: each message with its locale, and each locale on its own, for an id defined twice and a locale written two ways. What a host lints where it knows a catalogue only in part. |
| `read_catalogue(text)` | Reads a JSON catalogue, past a byte order mark, up to 512 levels deep and up to a string that is not well-formed Unicode text, and says where each string stands in the text, past its escape sequences, and which members a later one of the same name replaced. A `Located` string says where a byte of its value is written, with `offset_of`, and lists the escape sequences the file spells its characters with, with `escapes`, by which a host that counts other units than bytes locates it. `read_findings` is what the read found: the `unreadable-catalogue` finding of a text read in part. |
| `Plurals`, `Rules` | What the rules of a locale are asked through: the categories a locale's rules answer, and the category a number takes. |
| `KeptCategories` | What a `Plurals` gives from `kept()` to have what its rules answered for a locale kept from one call to the next, for at most 64 locales and types; `Cldr` keeps one. A host's own keeps none unless it gives one, and gives one only where a tag's rules answer the same for as long as it lives. |
| `Cldr` | The plural rules of the Unicode CLDR the crate carries, with the `cldr` feature. |
| `Table` | Plural rules stated as data, for a host whose rules live elsewhere: for a locale and a type, its categories and the numbers each takes among `probes()`, those the linter asks about. |
| `NoPlurals` | A host with no plural rules, by which the rules a locale decides find nothing. |
| `RULES` | Every rule: its code, severity, scope and the section of the specification it rests on. |
| `locale_key(tag)` | The key two spellings of one locale share: lowercase, with `-` for `_`. |
| `command::run(argv, host)` | The `curly-lint` command over a `command::Host`, which reads the files, takes the report and has the plural rules: what the binary runs over the file system, and what another host runs over its own. |

A finding carries its `code`, its `severity`, an English `message` saying
what is wrong and what happens instead, the `section` of the specification it
rests on where one does, and `start` and `end`, a range of bytes of the
message, the unit a `str` is indexed by. The fixtures and the npm
package count UTF-16 code units, and so do the columns `curly-lint` prints,
as an editor does. A finding about a whole message spans nothing, from 0 to
0. Findings come in one order: by `entry` in a catalogue, then by `start`,
then by `end`, then by their rule's place in `RULES`, then by `message`,
comparing UTF-16 code units.

No function of the library panics on a message, a list of entries or a text,
and none reads a file or writes anywhere: the command does, through its host.
The crate holds no `unsafe` code. `wasm/` beside it in the repository, the binding the npm package is built
from, is a crate of its own that is not published, and holds the
`unsafe` its exports and its imports need.

## Features

| Feature | Default | What it adds |
| --- | --- | --- |
| `cldr` | yes | `Cldr`, the plural rules of the CLDR as data in the crate, about 230 kB of JSON, and the `curly-lint` binary, which reads a locale's categories from them. |

Without it, `default-features = false`, the library is the rules over the
plural rules it is handed, a `Table` or a `Plurals` of the host's: what a
build for `wasm32-unknown-unknown` takes, where the host has plural rules of
its own, as the npm package's build does with those of `Intl`.

## Rules

Each rule is described, with what it finds and what to write instead, in the
[npm package's README](../lint/README.md#rules).

| Code | Severity | Section | What it finds |
| --- | --- | --- | --- |
| `unclosed-placeholder` | error | 6 | A `{{` that opens no placeholder, and renders as text. |
| `unknown-modifier` | error | 11.4 | A modifier neither the format defines nor the host registers. |
| `missing-options` | error | 9.5 | A selection that declares no options. |
| `nesting-limit` | error | 13 | A placeholder written deeper than resolution goes. |
| `default-case` | error | 9.3 | An option keyed `default` in another case, which is no inline default. |
| `duplicate-option` | warning | 11.1 | An option an earlier one selects in place of, or a second `default`. |
| `unreachable-option` | warning | 11.1 | An option its modifier never selects. |
| `unknown-category` | error | 11.5 | A key of a plural selection that is neither a category nor a number. |
| `inert-escape` | warning | 7 | An escape sequence that cancels nothing. |
| `bare-count` | warning | 11.5 | A count shown as written beside a `plural` that selects by the number shown. |
| `unused-category` | warning | 11.5 | A plural category the locale never answers. |
| `missing-category` | error | 11.5 | A plural category the locale answers and the selection has no option for. |
| `keyed-category` | warning | 11.5 | A plural category with no option, every count of which has a number key, so only negative numbers and fractions in it take the fallback chain. |
| `unreadable-catalogue` | error |  | A catalogue read only up to where it is not JSON, is not well-formed Unicode text or nests past 512 levels. |
| `duplicate-id` | error |  | An id defined twice in one locale. |
| `duplicate-locale` | warning |  | A locale written two ways, its tags differing only in case or `_` for `-`. |
| `missing-source` | error |  | A source locale that is no locale of the catalogue, so no other locale is compared with it. |
| `missing-message` | warning |  | A message the source locale has and another locale lacks. |
| `orphan-message` | warning |  | A message the source locale lacks. |
| `parameter-mismatch` | error | 9.2 | A message that reads other parameters than the source locale's. |
| `modifier-mismatch` | warning | 11 | A parameter shown with another modifier than in the source locale. |
| `missing-number-key` | warning | 11.5 | A number key the source locale's selection has and another's lacks. |

## Limits

What a call costs grows with the text it is given. A message is walked once,
a catalogue file is read once and up to 512 levels deep, and a locale's
plural rules are asked about a fixed list of numbers, once for each locale of
a call.

## Benchmark

`sh bench/prepare.sh && node bench/harness.mjs`, run from this directory,
measures the release build: the size of the `.crate` and of the stripped
command, the crates a build compiles, what the command asks of its host, and
times of the library and of the command.
`node bench/harness.mjs --compare <dir>` sets it beside the crate prepared
the same way at `<dir>`.

## License

[MIT](LICENSE). The plural rules and language aliases in `cldr/` are the
Unicode CLDR's, under the [Unicode License v3](cldr/LICENSE).
