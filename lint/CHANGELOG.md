# Changelog

### 1.0.0 (Unreleased)

The first version: a linter for messages and catalogues of the Curly Message
Format, as a library and as the `curly-lint` command.

* **Rules a message decides on its own**: a `{{` that opens no placeholder, a
  modifier nobody registered, or one of Intl's where the host satisfies Core
  alone, a selection with no options, nesting past the limit, `default` spelled
  in another case, an option an earlier one selects in place of, an option its
  modifier never selects, a plural key that is neither a category nor a number,
  an escape that cancels nothing, and a count shown as written beside `plural`.
* **Rules a locale decides**: a plural category the locale never answers, and
  one it answers that the selection has no option for, a warning where number
  keys cover every count in it.
* **Rules a catalogue decides**: a catalogue that cannot be read in full, an
  id defined twice, a locale written two ways, a source locale that is no
  locale of the catalogue, a message one locale has and another lacks, a
  message reading other parameters or showing one with another modifier than
  the source locale's, and a number key the source locale's selection has and
  another's lacks. Locale tags are told apart without regard to case, with `_` read as
  `-`, in the library and in `curly-lint`'s `--source`.
* **`curly-lint`** reads the JSON catalogues a pattern such as
  `"locales/{locale}/{namespace}.json"` names, takes each file's locale and
  namespace where the pattern places them, and guesses neither: it says how
  many files it read without a locale. It points each finding at its line and
  column, past the escape sequences JSON spells a string with. Its text
  report, and each line naming a path it cannot read, writes each line
  terminator, control character and bidirectional control a path, an id or a
  message holds by its code point, as `U+000A`, so each finding stays on its
  line as written. A file that is
  not JSON is an `unreadable-catalogue` error, and nothing under its namespace
  is compared. A reader that closes the output early, as `head` does, ends the
  report, not the run: the command exits as the lint decided. Output that
  cannot be written, as on a full disk, is said on stderr and exits 2. A file
  or a directory it cannot read is named on stderr and the rest is still read
  and linted, the command exiting 2. What a file it cannot read holds is
  unknown, as for a file that is not JSON: nothing under its namespace is
  compared, and the locale it would be read in counts as one. What a
  directory it cannot read holds is unknown too: where its files would be
  read in a locale, no locale is compared with another in that run, and each
  message is still linted with its locale.
* **The library** exports `lintMessage`, `lintCatalogue`, `lintEntries`,
  `entriesOf`, `flatten`, `readCatalogue` and the `RULES` table. Findings
  come in one order: by `entry` in a catalogue, then by `start`, then by
  `end`, then by their rule's place in `RULES`, then by `message`, comparing
  UTF-16 code units.
* **Text that is not well-formed Unicode**, holding a surrogate that pairs
  with no other, is no message and no id. A catalogue is read up to the first
  such string, as up to where it stops being JSON, with an
  `unreadable-catalogue` error: in a file, where that surrogate is written,
  escaped or not; in a list of entries or a tree, on the first message whose
  locale, id or text is such text, and no message read before it is then
  compared with another locale's. `lintMessage` finds nothing in such a
  message. An unpaired surrogate in `source` or in a locale of `locales`, a
  caller's options rather than catalogue text, reads as U+FFFD.
* **A tree handed to `lintCatalogue` is read up to a million messages**, an
  object it holds in several places counted in each. One that holds more is
  an `unreadable-catalogue` error on the last message read, and no message is
  then compared with another locale's.
