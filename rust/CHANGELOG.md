# Changelog

## 1.0.0

The first version: the linter for messages and catalogues of the Curly
Message Format in Rust, as a library and as the `curly-lint` command.

* **Every rule of `@curly-message/lint`**, answering each case of the fixture
  set as it does: the rules a message decides on its own, those a locale
  decides, and those a catalogue decides.
* **`lint_entries_uncompared`** lints a list of entries as `lint_entries`
  does, but compares no locale with the source one, for a catalogue known
  only in part.
* **`read_catalogue`** reads a JSON catalogue and says where each string
  stands, past its escape sequences, up to 512 levels deep and up to
  the first string that is not well-formed Unicode text.
  Each string lists its escape sequences, `Located::escapes`, by which a
  host that counts other units than bytes locates it.
* **`curly-lint`** is the command of `@curly-message/lint` as a native
  program: the same arguments, report and exit codes. It hands its `Host`
  the report a problem at a time, as JSON as well as text, so that the
  report is never held whole.
* **Plural rules are handed in.** A rule asks them through `Plurals`: `Cldr`,
  the rules of the Unicode CLDR 48 the crate carries with the `cldr` feature,
  a `Table` of rules stated as data, or a host's own. They are asked only
  for a locale tag that is well-formed, as `Intl` takes one, so a host's
  `Intl` is never handed one it would refuse.
  A `Plurals` that gives a `KeptCategories` from `kept()`, as `Cldr` does,
  is asked about a locale once for as long as it keeps it, not once a call.
* **Offsets count bytes** of the message or the file, where the npm
  package counts UTF-16 code units; the command's columns count UTF-16 code
  units, as an editor does.
