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

- **One root, one install**: one lockfile at the root, one `npm ci`, each
  workspace with its own build, tests, README, CHANGELOG, LICENSE and version
  line. Run every command from the root.
- **Release tags are namespaced by workspace** — `lint-v1.0.0` — and the
  publish workflow cuts them (`.github/workflows/publish.yml`; the README's
  Releasing section says what it does).
- **The lockfile is written with npm 11** (`npx npm@11 install`). npm 10 fails
  to resolve the workspaces' peer dependencies, though it installs from the
  lockfile (`npm ci`) as CI's Node 22 does.
- Issues live in the family's
  [shared tracker](https://github.com/curly-message/spec/issues).

Tech stack — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Package | `@curly-message/lint`, unreleased; its first version, `1.0.0-next.0`, is published by hand |
| Language | TypeScript, ESM only |
| Package manager | npm 11, workspaces |
| Build | tsup |
| Tests | vitest |
| Lint | ESLint flat config with `@stylistic`, run by a pre-commit hook |
| Dependencies | `@curly-message/parser` as a peer, and as a `devDependency` to build and test against |
| Supported runtimes | Node 22+ |
| CI | `tests.yml`, `publish.yml` |

Commands, run from the root:

| Command | What it does |
|---------|--------------|
| `npm ci` | install from the lockfile |
| `npm test` | build, typecheck, lint, then the suite, for every workspace — what CI runs |
| `npm run lint:fix` | fix what the formatting contract reports |

Map of `lint/src/`:

| Path | Role |
|------|------|
| `rules.ts` | the table of rules, `RULES` |
| `tree.ts` | reads a message off the parser's tree |
| `message.ts`, `catalogue.ts` | the rules |
| `read.ts`, `locale.ts` | read files, and a locale and namespace off a path |
| `run.ts` | the command; `cli.ts` only starts it |

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
  `CHANGELOG.md`. `lint/README.md` lists every rule, and a test holds it to
  `RULES`: a new rule is a row in `RULES` and a section in `lint/README.md`.
- A finding's message is English, says what is wrong and what happens instead,
  and quotes what it is about in backticks.

## Tests

- `lint/tests/` drives the rules through `lintMessage` and `lintCatalogue`,
  the reader through `readCatalogue`, and the command through `run` from
  `src/run.ts`.
