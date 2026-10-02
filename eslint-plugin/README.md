# @curly-message/eslint-plugin

ESLint rules for the [Curly Message Format](https://github.com/curly-message/spec).
They put what [`@curly-message/lint`](../lint) finds in a message under the
reader's cursor: in a JSON catalogue, in a catalogue written as a JavaScript or
TypeScript module, and in a message passed straight to `resolve`.

A linter handed one file at a time sees one locale at a time, so the rules that
compare locales — a parameter one translation reads and another does not, a
message one has and another lacks — are the command line's, `curly-lint`, and
not here.

## Installation

```bash
npm install --save-dev @curly-message/eslint-plugin @curly-message/parser @eslint/json
```

ESLint 9 or later. The Curly Message parser is a peer dependency, as it is of
the library: a message is read with the parser the project resolves it with.
JSON is linted through ESLint's own [`@eslint/json`](https://github.com/eslint/json),
and TypeScript through a parser ESLint does not ship, such as
[`typescript-eslint`](https://typescript-eslint.io)'s.

## Configuration

```js
// eslint.config.js
import curly from '@curly-message/eslint-plugin';
import json from '@eslint/json';
import tseslint from 'typescript-eslint';

export default [
  // TypeScript is read by its own parser.
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },

  // Messages passed to `resolve` in source code.
  { files: ['src/**/*.{js,ts}'], ...curly.configs.recommended },

  // A catalogue written as a module: every string a property or an array
  // holds.
  {
    files: ['src/lib/translations/**/*.{js,ts}'],
    ...curly.configs.recommended,
    settings: { 'curly-message': { catalogue: true } },
  },

  // A JSON catalogue: every string a member or an element holds.
  {
    files: ['src/lib/translations/**/*.json'],
    language: 'json/json',
    plugins: { json, ...curly.configs.recommended.plugins },
    rules: curly.configs.recommended.rules,
  },
];
```

`recommended` turns every rule on, an error as `error` and a warning as `warn`.

### Settings

Under `settings['curly-message']`:

| Setting | Meaning |
| --- | --- |
| `callees` | The functions whose first argument is a message, by name or by the property a method is called through. `['resolve']` where none is named. |
| `catalogue` | Whether every string a property of an object literal or an array holds is a message. JSON is always read this way. |
| `locale` | The locale of every message in the file, written with `-` or `_`. Where none is named, a catalogue's path names the locale of the strings the catalogue holds, as `curly-lint` reads it from the working directory — `translations/cs/common.json` holds `cs` — and a message passed to a call has none, since it may be resolved for any. |
| `modifiers` | The names of the modifiers the host registers. |
| `intl` | Whether the host satisfies the Intl level. `false` is a host that satisfies Core alone, which does not have `number`, `date`, `ago`, `currency`, `plural` or `ordinal` unless it registers them. |

A finding points at the characters it is about. In JSON it points past the
escape sequences at its own characters. A JavaScript string read otherwise
than its source spells it — through an escape sequence, or a template's line
break written as `\r\n` — is pointed at whole.

## Rules

Each rule is the `@curly-message/lint` rule of the same name, and its README
says what each finds.

| Rule | Severity in `recommended` |
| --- | --- |
| `@curly-message/unclosed-placeholder` | error |
| `@curly-message/unknown-modifier` | error |
| `@curly-message/missing-options` | error |
| `@curly-message/nesting-limit` | error |
| `@curly-message/default-case` | error |
| `@curly-message/duplicate-option` | warn |
| `@curly-message/unreachable-option` | warn |
| `@curly-message/unknown-category` | error |
| `@curly-message/inert-escape` | warn |
| `@curly-message/bare-count` | warn |
| `@curly-message/unused-category` | warn |
| `@curly-message/missing-category` | error |
| `@curly-message/keyed-category` | warn |

`unused-category`, `missing-category` and `keyed-category` need a locale, and
report nothing where the settings and the path name none.

## License

[MIT](./LICENSE)
