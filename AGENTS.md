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

A linter for the [Curly Message Format](https://github.com/curly-message/spec):
the rules written once, in the Rust crate, and one npm workspace per
JavaScript package, which runs the crate compiled to WebAssembly.

| Path | Package |
|------|---------|
| `lint/` | `@curly-message/lint`: the crate's rules as WebAssembly, a library over them and the `curly-lint` command |
| `eslint-plugin/` | `@curly-message/eslint-plugin`: the rules a single message decides, as ESLint rules |
| `rust/` | `curly-message-lint`: the rules, the catalogue reader and the `curly-lint` command; `rust/wasm/`, the binding the library is built from |

- **Workspaces of one root**, because the plugin depends on the library and
  both change together: one lockfile at the root, one `npm ci`, each
  workspace with its own build, tests, README, CHANGELOG, LICENSE and version
  line. Run every npm command from the root.
- **`rust/` is a Cargo workspace of its own**, outside npm's: the crate, and
  two members that are not published, `bench/`, the program its benchmark
  measures, and `wasm/`, the crate without `cldr` behind a hand-written ABI.
  Run every cargo command from `rust/`.
- **The library's build compiles the crate.** `lint/build-core.mjs` builds
  `rust/wasm/` for `wasm32-unknown-unknown` under the `wasm` profile, from
  the lockfile, with this machine's paths written as names so that the bytes
  do not depend on where they were built, and copies the module to
  `lint/core.wasm`, which is ignored and which tsup inlines into the bundle
  as base64. So every npm command that builds needs Rust with that target,
  and a change under `rust/` is a change to both npm packages. The suite's
  run against the source compiles the core first, and `npm run dev` before
  it watches the TypeScript, which it does not compile again: a change under
  `rust/` while it watches takes `npm run build`.
- **Release tags are namespaced by directory** — `lint-v1.0.0`,
  `eslint-plugin-v1.0.0`, `rust-v1.0.0` — and the publish workflows cut them
  (`.github/workflows/publish.yml` for the workspaces, `publish-rust.yml` for
  the crate; the README's Releasing section says what they do).
- **The lockfile is written with npm 11** (`npx npm@11 install`). npm 10 fails
  to resolve the workspaces' peer dependencies, though it installs from the
  lockfile (`npm ci`) as CI's Node 22 does.
- **macOS runs the ends of each test matrix.** GitHub places few macOS
  jobs at once, so on macOS `tests.yml` runs only the oldest and the newest
  version of each runtime or toolchain, and one variant of an axis Linux
  runs both ways (Rust with `cldr`); Linux and Windows run the whole matrix.
  A job GitHub never places ends cancelled with no runner and no step:
  `rerun.yml` re-runs the failed jobs of a test workflow's first attempt
  once, where every job that neither succeeded nor was skipped is such a
  job, and leaves alone a run with one that ran.
- Issues live in the family's
  [shared tracker](https://github.com/curly-message/spec/issues).

Tech stack — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Packages | `@curly-message/lint` and `@curly-message/eslint-plugin`, released, `1.0.0`; the first version of each, the prerelease `1.0.0-next.0`, was published by hand |
| Language | TypeScript, ESM only |
| Package manager | npm 11, workspaces |
| Build | tsup |
| Tests | vitest |
| Lint | ESLint flat config with `@stylistic`, run by a pre-commit hook |
| Build | of the core: stable Rust with the `wasm32-unknown-unknown` target, through `lint/build-core.mjs` |
| Dependencies | the library: none, the parser being the crate's and compiled into the core; the plugin: the library pinned exactly, ESLint 9+ as a peer |
| Supported runtimes | Node 22+, Bun, Deno 2, each with its WebAssembly |
| CI | `tests.yml`, `bench.yml` and `bench-label.yml`, `publish.yml` |

Tech stack of `rust/` — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Package | `curly-message-lint`, a library and the `curly-lint` binary, released, `1.0.0`; the first version, the prerelease `1.0.0-next.0`, was published by hand |
| Language | Rust, edition 2024, no `unsafe`: the workspace forbids it, and `wasm/` alone denies it in its place, so that `wasm/src/abi.rs` can allow what an export and an import are written with |
| Toolchains | Rust 1.88 and stable, on Linux, macOS and Windows; the library without `cldr` also builds for `wasm32-unknown-unknown` |
| Tests | `cargo test`; the fixture runner through `libtest-mimic`, a case a test |
| Lint | rustfmt and Clippy, at the lints `Cargo.toml` denies: a panic, an index, a slice of a `str`, unchecked arithmetic, a character outside ASCII in a literal, a write to the standard streams |
| Features | `cldr`, default: the plural rules of the Unicode CLDR as data in the crate (`cldr/`, under the Unicode License v3), which the binary requires |
| Dependencies | `curly-message-parser`, and `unicode-properties` for the characters a report shows by code point; `serde_json`, `sha2` and `libtest-mimic` for the tests alone |
| CI | the `Rust` and `Rust-lint` jobs of `tests.yml`, the `rust` leg of `bench.yml`, `publish-rust.yml`; a change under `rust/` runs the npm jobs and benchmarks too, which build it |

Commands, run from the root:

| Command | What it does |
|---------|--------------|
| `npm ci` | install from the lockfile |
| `npm test` | build, the core included, typecheck the source and the shipped declarations, lint, then the suite against the source and against the build, for every workspace — what CI runs |
| `npm run test:bun`, `npm run test:deno` | build, then the suite on Bun or Deno, for every workspace — what the runtime legs of CI run |
| `npm run bench --workspace <path>` | build, then the workspace's benchmark (`<path>/bench/rows.mjs`) |
| `npm run bench --workspace <path> -- --compare <dir>` | the same, beside the workspace checked out and built at `<dir>` — what `bench.yml` runs on a PR |
| `npm run lint:fix` | fix what the formatting contract reports |

Commands, run from `rust/`:

| Command | What it does |
|---------|--------------|
| `cargo test`, `cargo test --no-default-features` | the suite, with the plural rules the crate carries and without them |
| `cargo fmt --all --check`, `cargo fmt --all` | report, or fix, what the formatting contract reports |
| `cargo clippy --workspace --all-targets -- -D warnings` | the lints; once more with `-p curly-message-lint --no-default-features`, and once with `-p curly-message-lint-wasm --target wasm32-unknown-unknown` |
| `cargo build --lib --no-default-features --target wasm32-unknown-unknown` | the library as a host with plural rules of its own takes it |
| `sh bench/prepare.sh && node bench/harness.mjs` | build the release into `bench/dist/`, then the benchmark (`bench/rows.mjs`) |
| `node bench/harness.mjs --compare <dir>` | the same, beside the crate prepared at `<dir>` — what `bench.yml` runs on a PR |

Map of `lint/src/`:

| Path | Role |
|------|------|
| `rules.ts` | the table of rules, `RULES`, which a test holds to the core's |
| `core.ts` | the core: its instances, a request written into its memory and an answer read out of it, `CoreError` |
| `plural.ts` | the plural rules the core is handed: `Intl`'s, or a case's |
| `catalogue.ts` | `lintCatalogue`, `lintEntries`, `entriesOf` and `flatten`: the walk over objects of the host, and what is settled before the core is asked |
| `read.ts` | `readCatalogue`: the core's reading of a text, each string with where its characters stand |
| `host.ts`, `output.ts` | the command's host, `run`: the file system the core's command asks for, and the streams its report is written to; `cli.ts` only starts it |
| `internal.ts` | what the suite reaches that the package does not export: the rules handed plural rules in place of `Intl`'s, the findings a file yields as it is read, and the instance a set of plural rules holds; built beside the entry, and left out of `exports` and of the tarball |

Map of `rust/`:

| Path | Role |
|------|------|
| `src/rules.rs` | the table of rules, `RULES` |
| `src/tree.rs` | reads a message off the parser's tree |
| `src/message.rs`, `src/catalogue.rs` | the rules |
| `src/plural.rs` | `Plurals`, what a locale's plural rules are asked through, and `Table`, rules stated as data |
| `src/cldr.rs`, `cldr/` | `Cldr`: the CLDR's plural rules and language aliases as its JSON, and the evaluator of its rule syntax, behind the `cldr` feature |
| `src/tag.rs` | a locale tag's key and its subtags |
| `src/read.rs`, `src/locale.rs` | read a catalogue's text, and the locale and namespace a pattern places in a path |
| `src/command.rs` | the command over a `Host`, which reads the files and takes the report |
| `src/bin/curly-lint/` | the binary: the host over the file system and the standard streams |
| `tests/` | the suite (see *Tests*) |
| `bench/` | the benchmark's program, its rows, and the crate's copies of the harness and of `check/` |
| `wasm/` | the binding: `src/abi.rs`, the exports, the imports and the allocator; `src/wire.rs`, a request and an answer; `src/plurals.rs` and `src/host.rs`, the plural rules and the command's host over the imports |

The plugin is `eslint-plugin/src/index.ts`: the rules a single message
decides, with or without its locale. The rules that compare locales stay the
command's, since ESLint hands a rule one file.

`fixtures/` at the root is the linter's contract as data, for every
implementation: JSON cases of a message, a list of entries or a catalogue
file's text, each with its findings, and the plural rules a case is read with
in place of the host's; `fixtures/schema.json` is their schema and
`fixtures/README.md` says what a runner does.

Each workspace's `bench/rows.mjs` lists the rows of its benchmark, each read
off the build. `bench/harness.mjs` at the root measures them for both,
`bench/check/` beside it holds the rows it is checked on, and both are the same
in every repository of the family. `rust/bench/` holds its own copies of
both, which `tests.yml` holds to the root's, and rows that read the release
build over a child process.

## The format decides, not the linter

- **The specification is normative.** A rule about a message finds what the
  specification says renders other than its author meant, and names the
  section it rests on. A rule the specification does not back is a rule about
  taste, and does not belong here. The specification leaves catalogues to the
  host (section 1), so a rule about one finds what reading the catalogue loses
  — a message one locale has and another lacks, the one of two under an id
  that is never read — and names no section.
- **The linter agrees with the parser.** The crate reads a message through
  `curly-message-parser`'s `cst` and its public conversions, and copies none
  of the parser's code, so what it calls a placeholder is what resolution
  calls one. Where a rule needs a reading `cst` does not give — what `eq`
  compares, what `plural` takes for a number — it follows the parser's
  reading of the specification, and a disagreement is a bug in one of them:
  decide which and say so. The npm packages carry that parser inside the
  core, at the version the crate's lockfile resolves, and take none as a
  peer: the format is one, so the parser a project resolves with reads a
  message as the carried one does.
- **The rules are written once.** A rule, the reader of a catalogue's text
  and the command are the crate's, and the npm library adds none of its own:
  it hands the core a request and reads its answer. What the library does
  itself is what only its host can: walk an object of the host up to a
  million messages, refuse text that is not well-formed Unicode before it is
  encoded, ask `Intl` for plural rules, and read the files and write the
  streams the command asks for. A message, a list of entries or a file the
  library answers otherwise than the crate is a bug in the binding or at
  that edge, and the case that shows it joins `fixtures/`. What the two are
  allowed to differ in is what each host brings: the plural rules (`Intl`'s
  in JavaScript, the CLDR's the crate carries in Rust), the unit of an
  offset (UTF-16 code units, bytes), and what the system says of a path that
  cannot be read. A fixture holds no character two versions of Unicode a
  runner may have read otherwise: none assigned after the oldest of them,
  and none yet unassigned but a noncharacter.
- **`unsafe` stays in one file.** The crate has none. An export and an
  import of a WebAssembly module cannot be written without it, so
  `rust/wasm/src/abi.rs` holds every one of the binding, and nothing else of
  `rust/wasm/` may.
- **No payload.** Every rule is decidable from a message, its locale, or a
  catalogue. What a payload decides is the parser's to report while it
  resolves.
- **A linter never throws on a message**: any string is a message it can
  read, and a file that is not JSON is a finding, not a crash. In Rust that
  is no panic on any input: the lints deny what can raise one, and the
  binary exits 2 on a fault it did not foresee. The npm library throws one
  thing, `CoreError`, where the core could not finish whatever the message
  was: a runtime with no WebAssembly, the 2 GiB the core's memory may grow
  to, a stack that ran out within the call, plural rules or a file system
  that threw what names no code of the system; its `cause` is what was
  thrown, and does not always say which. The instance is then
  dropped and the next call starts another; the command says it on standard
  error and exits 2, and the plugin lets it through.

## Robustness

The linter reads catalogues a project does not control in full, and runs in
editors on every keystroke.

- **Bounded work.** What a rule does grows with the message, never with a
  value outside it. A rule that walks the tree walks it once, and a catalogue
  is read up to a million messages, however often it holds one object.
- **The core's memory is bounded and given back.** A module's memory only
  grows, so the core may grow to 2 GiB (`MAX_MEMORY`,
  `rust/wasm/src/memory.rs`), where an address still reads in JavaScript as
  the non-negative number it is. A list of entries crosses into it in
  batches of `BATCH` code units, each entry weighing `ENTRY` more, one entry
  larger than a batch crossing alone, and is linted once; findings leave in
  answers of about 1 MiB, each cut at a finding. The core holds the text in
  UTF-8, and `lint/tests/core.spec.ts` holds lists of 50 000 to 400 000
  entries within twice their text and the text of their findings, a
  finding's holding what it quotes, beside 400 bytes a message and 300 a
  finding. An instance a call left above
  `KEPT`, 16 MiB, is dropped for the next call to start a new one. Its
  allocator takes half the memory again whenever it has to grow, or what is
  left below the most, since a runtime collects garbage on each growth.
- **Prototype keys are names.** A catalogue's `__proto__` member is a member;
  read an object's own data members, or read onto a null prototype.
- **No host code.** The linter calls no function a catalogue holds, an
  accessor included.

## Docs and findings

- The docs are the root `README.md`, each workspace's `README.md` and
  `CHANGELOG.md`, and the crate's, with the doc comments of its public items.
  `rust/README.md` lists every rule in one table, which a test holds to
  `RULES`, and leaves each rule's description to `lint/README.md`. Each
  workspace's README lists every rule, and a test holds it to `RULES`: a new
  rule is a row in the crate's `RULES` and in `lint/src/rules.ts`, which a
  test holds to the core's, a section in
  `lint/README.md`, and — where a single message decides it — a row in
  `eslint-plugin/README.md`.
- `lint/THIRD-PARTY-NOTICES.md` lists what the compiled core holds, with the
  terms of each, and ships in the tarball: a dependency the crate gains
  without `cldr` is a row there.
- A finding's message is English, says what is wrong and what happens instead,
  and quotes what it is about in backticks.

## Tests

- `lint/tests/fixtures.spec.ts` validates every file of `fixtures/` against
  its schema and runs every case: a message through `lintMessage`, a list of
  entries through `lintEntries`, each with the case's plural rules, and a
  file's text through `readCatalogue`. A case data can state is a fixture,
  not an inline test.
- The rest of `lint/tests/` holds what data cannot state: `lintCatalogue`
  and `flatten` over objects of the host, input of another type than the
  declarations give, the plural rules of the host's `Intl` asked directly,
  inputs too large for a fixture, the core itself (`core.spec.ts`: its table
  of rules against `RULES`, the instance dropped past `KEPT`, `CoreError`
  and the call after it), and the command's host through `run` from
  `src/host.ts`, then once through the built `dist/cli.js`, as a project
  runs it. What the command decides from its arguments and its files is the
  crate's to test, in `rust/tests/command.rs`, over files held in memory;
  `cli.spec.ts` keeps what takes a file system: links, paths that cannot be
  read, the calls it is asked, by count, and the streams. `eslint-plugin/tests/` drives the plugin through ESLint's own `Linter`.
- Each workspace's `tests/types/surface.ts` asserts that the declarations the
  build ships are the source's, compiled as a consumer compiles them: through
  the package's own `exports`, at `skipLibCheck: false`.
  `npm run typecheck:dist` runs it; `npm test` runs it before the suite.
- `rust/tests/fixtures/` runs the same set: it holds every file to
  `fixtures/schema.json`, read by a validator of the keywords the schema
  uses, and runs every case, converting the set's UTF-16 offsets to bytes at
  its edge. `rust/tests/command.rs` runs the command over files held in
  memory, `rust/tests/cli.rs` through the built binary, or through the one
  `CURLY_LINT_BIN` names by its path, as a package that ships it installs
  it, and
  `rust/tests/library.rs` holds what data cannot state: the CLDR data's
  digests, random and large inputs that must not panic, and the README's
  table of rules and its version of Unicode. The tests in `rust/src/cldr.rs`
  hold its evaluator to the samples the CLDR's rules state, and the README's
  example runs as a doc test where the crate has `cldr`.
- Each suite imports its package by name and runs twice: against the source,
  and under `--mode dist` against the build a release ships. An import of the
  package by a path into `src/` tests the source twice; the command's `run`
  and its `output`, which the package does not export, are the modules
  imported by path, and
  `#internal`, which the suite resolves to `src/internal.ts` or to its build,
  the one imported by a name the package does not give.
