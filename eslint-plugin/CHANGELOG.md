# Changelog

### 1.0.0 (Unreleased)

The first version: ESLint rules for messages of the Curly Message Format.

* **A rule for each finding** `@curly-message/lint` makes in one message,
  with or without its locale, and a `recommended` config that turns them on.
  The settings name the host's modifiers, and whether it satisfies Intl.
* **Where messages are found**: the first argument of `resolve`, or of the
  calls named in `callees`; every string a property or an array holds in a
  catalogue written as a module; every string a JSON document holds, through
  `@eslint/json`.
* **The locale** is the one the settings name, or, for the strings a
  catalogue holds, the one its path names.
* **Findings point at their characters**, past the escape sequences of a JSON
  string, and at the whole string where JavaScript reads one otherwise than
  its source spells it.
