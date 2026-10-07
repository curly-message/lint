# AGENTS.md

Behavioral guidelines for LLM coding assistants working on the
**curly-message lint** repository.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

This repository follows the rules of the Curly Message Format family in
[`spec`'s AGENTS.md](https://github.com/curly-message/spec/blob/main/AGENTS.md)
(sections 1-14). What follows is only what differs here.

Those rules are not in this file, and nothing loads them for you: before any
change, read `spec`'s AGENTS.md in full — `../spec/AGENTS.md` when it is
checked out beside this repository on an up-to-date `main`, otherwise
[the raw file](https://raw.githubusercontent.com/curly-message/spec/main/AGENTS.md)
— and follow it as fully as the rules below.

---

## The repository

A linter for the [Curly Message Format](https://github.com/curly-message/spec),
one npm workspace per package:

| Path | Package |
|------|---------|
| `lint/` | `@curly-message/lint`: the rules, a library over them and the `curly-lint` command |
| `eslint-plugin/` | `@curly-message/eslint-plugin`: the rules a single message decides, as ESLint rules |

- **Workspaces of one root**, because the plugin depends on the library and
  both change together: one lockfile at the root, one `npm ci`, each
  workspace with its own build, tests, README, CHANGELOG, LICENSE and version
  line. Run every command from the root.
- **Release tags are namespaced by workspace** — `lint-v1.0.0`,
  `eslint-plugin-v1.0.0` — and the publish workflow cuts them
  (`.github/workflows/publish.yml`; the README's Releasing section says what
  it does).
- **The lockfile is written with npm 11** (`npx npm@11 install`). npm 10 fails
  to resolve the workspaces' peer dependencies, though it installs from the
  lockfile (`npm ci`) as CI's Node 22 does.
- Issues live in the family's
  [shared tracker](https://github.com/curly-message/spec/issues).

Tech stack — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Packages | `@curly-message/lint` and `@curly-message/eslint-plugin`, unreleased; the first version of each, `1.0.0-next.0`, is published by hand |
| Language | TypeScript, ESM only |
| Package manager | npm 11, workspaces |
| Build | tsup |
| Tests | vitest |
| Lint | ESLint flat config with `@stylistic`, run by a pre-commit hook |
| Dependencies | the library: `@curly-message/parser` as a peer, and as a `devDependency` to build and test against; the plugin: the library pinned exactly, the parser as a peer, ESLint 9+ as a peer |
| Supported runtimes | Node 22+, Bun, Deno 2 |
| CI | `tests.yml`, `publish.yml` |

Commands, run from the root:

| Command | What it does |
|---------|--------------|
| `npm ci` | install from the lockfile |
| `npm test` | build, typecheck the source and the shipped declarations, lint, then the suite against the source and against the build, for every workspace — what CI runs |
| `npm run test:bun`, `npm run test:deno` | build, then the suite on Bun or Deno, for every workspace — what the runtime legs of CI run |
| `npm run lint:fix` | fix what the formatting contract reports |

Map of `lint/src/`:

| Path | Role |
|------|------|
| `rules.ts` | the table of rules, `RULES` |
| `tree.ts` | reads a message off the parser's tree |
| `message.ts`, `catalogue.ts` | the rules |
| `read.ts`, `locale.ts` | read files, and a locale and namespace off a path |
| `run.ts` | the command; `cli.ts` only starts it |

The plugin is `eslint-plugin/src/index.ts`: the rules a single message
decides, with or without its locale. The rules that compare locales stay the
command's, since ESLint hands a rule one file.

## The format decides, not the linter

- **The specification is normative.** A rule about a message finds what the
  specification says renders other than its author meant, and names the
  section it rests on. A rule the specification does not back is a rule about
  taste, and does not belong here. The specification leaves catalogues to the
  host (section 1), so a rule about one finds what reading the catalogue loses
  — a message one locale has and another lacks, the one of two under an id
  that is never read — and names no section.
- **The linter agrees with the parser.** It reads a message through
  `@curly-message/parser`'s `cst`, so what it calls a placeholder is what
  resolution calls one, and it takes the parser as a peer, so a project lints
  with the parser it resolves with. Where a rule needs a reading `cst` does
  not give — what `eq` compares, what `plural` takes for a number — it follows
  the parser's reading of the specification, and a disagreement is a bug in
  one of them: decide which and say so.
- **No payload.** Every rule is decidable from a message, its locale, or a
  catalogue. What a payload decides is the parser's to report while it
  resolves.
- **A linter never throws on a message**: any string is a message it can
  read, and a file that is not JSON is a finding, not a crash.

## Robustness

The linter reads catalogues a project does not control in full, and runs in
editors on every keystroke.

- **Bounded work.** What a rule does grows with the message, never with a
  value outside it. A rule that walks the tree walks it once, and a catalogue
  is read up to a million messages, however often it holds one object.
- **Prototype keys are names.** A catalogue's `__proto__` member is a member;
  read an object's own data members, or read onto a null prototype.
- **No host code.** The linter calls no function a catalogue holds, an
  accessor included.

## Docs and findings

- The docs are the root `README.md` and each workspace's `README.md` and
  `CHANGELOG.md`. Each workspace's README lists every rule, and a test holds
  it to `RULES`: a new rule is a row in `RULES`, a section in
  `lint/README.md`, and — where a single message decides it — a row in
  `eslint-plugin/README.md`.
- A finding's message is English, says what is wrong and what happens instead,
  and quotes what it is about in backticks.

## Tests

- `lint/tests/` drives the rules through `lintMessage` and `lintCatalogue`,
  the reader through `readCatalogue`, and the command through `run` from
  `src/run.ts`, then once through the built `dist/cli.js`, as a project runs
  it. `eslint-plugin/tests/` drives the plugin through ESLint's own `Linter`.
- Each workspace's `tests/types/surface.ts` asserts that the declarations the
  build ships are the source's, compiled as a consumer compiles them: through
  the package's own `exports`, at `skipLibCheck: false`.
  `npm run typecheck:dist` runs it; `npm test` runs it before the suite.
- Each suite imports its package by name and runs twice: against the source,
  and under `--mode dist` against the build a release ships. An import of the
  package by a path into `src/` tests the source twice; the command's `run`,
  which the package does not export, is the one module imported by path.
