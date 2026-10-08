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
  id defined twice, a message one locale has and another lacks, a message
  reading other parameters or showing one with another modifier than the
  source locale's, and a number key the source locale's selection has and
  another's lacks.
* **`curly-lint`** reads the JSON catalogues a pattern such as
  `"locales/{locale}/{namespace}.json"` names, takes each file's locale and
  namespace where the pattern places them, and guesses neither: it says how
  many files it read without a locale. It points each finding at its line and
  column, past the escape sequences JSON spells a string with. A file that is
  not JSON is an `unreadable-catalogue` error, and nothing under its namespace
  is compared. A reader that closes the output early, as `head` does, ends the
  report, not the run: the command exits as the lint decided. Output that
  cannot be written, as on a full disk, is said on stderr and exits 2.
* **The library** exports `lintMessage`, `lintCatalogue`, `lintEntries`,
  `entriesOf`, `flatten`, `readCatalogue` and the `RULES` table.
