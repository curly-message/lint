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
| `python/` | `curly-message-lint` on PyPI: the crate's `curly-lint` command, a native program in a wheel per platform |
| `go/` | `github.com/curly-message/lint-go`: the crate's `curly-lint` command for the go command, a launcher in Go that carries the native program of its platform; served from `curly-message/lint-go` |
| `php/` | `curly-message/lint` for Composer: the crate's `curly-lint` command for Composer, a launcher in PHP that runs the native program of its platform; served from `curly-message/lint-php` |

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
- **`python/` is outside both**: a pyproject that maturin builds from the
  crate's manifest, and two scripts of the standard library alone,
  `build.py`, which runs maturin, and `tests/dist.py`, which checks what it
  built; the package ships no Python. Run its commands from `python/`.
- **`go/` is a Go module of its own**, outside all three: the launcher,
  `cmd/curly-lint/`, in the standard library alone, and `pack.sh`, which
  packs it with the native commands as a release serves it. The commands
  are no file of this repository: the launcher embeds them from
  `cmd/curly-lint/bin/`, which is ignored here and which only the mirror
  holds, so the package builds here once `bench/prepare.sh` has put this
  machine's there. Run its commands from `go/`.
- **The Go module is served from `curly-message/lint-go`**, which the go
  command reads and only `publish-go.yml` writes to: a version there is
  `go/` as its tag `go-vX.Y.Z` holds it here, but for `BENCH.md`, with the
  six commands built from that tag, tagged `vX.Y.Z`. A change to the package
  is a change to `go/` here. The module's path names no major version, so
  its version line stays below `v2`, and a version the module proxy has
  served is never moved or deleted: a bad one is retracted by the next.
- **`php/` is a Composer package of its own**, outside all four: the
  launcher, `bin/curly-lint`, one file of PHP that requires no package and
  no extension, and `pack.sh`, which packs it with the native commands as a
  release serves it. The commands are no file of this repository: the
  launcher runs the one of its platform from `commands/`, which is ignored
  here and which only the mirror holds, so the package is installed here
  once `bench/prepare.sh` has built this machine's there. The launcher is
  tested only as Composer installs it, never from the working tree. Run its
  commands from `php/`.
- **The Composer package is served from `curly-message/lint-php`**, which
  Packagist reads and only `publish-php.yml` writes to: a version there is
  `php/` as its tag `php-vX.Y.Z` holds it here, but for `BENCH.md`, with
  the five commands built from that tag, tagged `vX.Y.Z`. A change to the
  package is a change to `php/` here. Packagist locks the commit of each
  version it has read, a release candidate included, so a tag of the mirror
  is never moved or deleted: a bad version is followed by the next.
- **Release tags are namespaced by directory** — `lint-v1.0.0`,
  `eslint-plugin-v1.0.0`, `rust-v1.0.0`, `python-v1.0.0`, `go-v1.0.0`,
  `php-v1.0.0` — and
  the publish workflows cut them (`.github/workflows/publish.yml` for the
  workspaces, `publish-rust.yml` for the crate, `publish-python.yml` for the
  Python package, `publish-go.yml` for the Go module and `publish-php.yml`
  for the Composer package, each of which tags its mirror `v1.0.0` too; the
  README's Releasing section says what they do).
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
| CI | the `Rust` and `Rust-lint` jobs of `tests.yml`, the `rust` leg of `bench.yml`, `publish-rust.yml`; a change under `rust/` runs the npm jobs and benchmarks too, which build it, and `tests-python.yml`, `tests-go.yml`, `tests-php.yml` and the `python`, `go` and `php` legs of `bench.yml`, which ship it |

Tech stack of `python/` — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Package | `curly-message-lint` on PyPI, the `curly-lint` command alone, no Python API; released, `1.0.0`; the first version, the release candidate `1.0.0rc0`, was published by the workflow through a trusted publisher registered beforehand. Its own version line; the README and the changelog name the crate release each version carries |
| Build | maturin (`bindings = "bin"`, the crate's manifest, `--locked`), hash-pinned with `ziglang` in `build-constraints.txt`, through `build.py`, which writes this machine's paths as names unless `RUSTFLAGS` or `CARGO_ENCODED_RUSTFLAGS` is set; the C runtime linked statically on Windows, by the `config` of `pyproject.toml`, which a build from the sdist reads too; one named stable Rust in `build.yml` |
| Platforms | a wheel each for `manylinux_2_17` (zig) and `musllinux_1_2` on x86-64 and ARM64, `macosx_10_12_x86_64`, `macosx_11_0_arm64`, `win_amd64` and `win_arm64`, tagged `py3-none`, with no `requires-python`; the sdist, built by Rust 1.88 or newer |
| Tests | on each platform's leg: `tests/dist.py` on what the build wrote (a Windows command that imports a C runtime DLL fails it), the crate's `cargo test` for that target, and `rust/tests/cli.rs` against the command the wheel installs through pip (on Alpine for musl); the sdist built on Rust 1.88 and held to `cli.rs` |
| Licenses | `LICENSE` and `THIRD-PARTY-NOTICES.md` in every wheel, the notices held by `tests/dist.py` to the SBOM maturin writes: a crate the binary gains is a row there |
| CI | `tests-python.yml` (calls `build.yml`, filtered by path, so never a required check), the `python` leg of `bench.yml`, `publish-python.yml` |

Tech stack of `go/` — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Module | `github.com/curly-message/lint-go`, one package, `cmd/curly-lint`, the `curly-lint` command alone, no Go API; released, `v1.0.0`; the first version, the prerelease `v1.0.0-next.0`, was cut by the workflow, whose tag on the mirror is the release. Its own version line, below `v2`; the README and the changelog name the crate release each version carries |
| Language | Go 1.24+, the first with a `tool` line in `go.mod`; the standard library alone |
| Build | none here: `pack.sh` puts the commands beside the launcher in a git repository of its own and has the go command fetch it, as the proxy fetches the mirror, which writes the module's zip and its `h1:` sum; the commands are those of the wheels `build.yml` builds, for Linux the ones linked statically against musl |
| Platforms | `linux`, `darwin` and `windows` on `amd64` and `arm64`; built for any other, Android and iOS among them, the launcher holds no command, says so and exits 2 |
| Tests | `go test`, in `build-go.yml`, on each platform and on Go 1.24 and stable, of the module as the go command installs it from a proxy of the packed tree: the launcher's own tests from the module cache, `rust/tests/cli.rs` against the installed launcher, and on Linux a run in Alpine beside the runner's glibc |
| Lint | `gofmt`, `go vet` for each platform and two the module holds no command for, `go mod tidy -diff`, ASCII-only `.go`, all run by `build-go.yml`'s Module job on the packed tree |
| Runtime dependencies | none: the module requires no module |
| Licenses | `LICENSE`, a copy of the root's, and `THIRD-PARTY-NOTICES.md` in the module, both held by `tests.yml`: the notices to the rows and the texts of the Python package's, so a crate the binary gains is a row in both |
| CI | `tests-go.yml` (calls `build-go.yml`, which calls `build.yml`; filtered by path, so never a required check), the `go` leg of `bench.yml`, `publish-go.yml` |

Tech stack of `php/` — **ground truth, do not assume otherwise**:

| | |
|---|---|
| Package | `curly-message/lint` for Composer, the `curly-lint` command alone, no PHP API and nothing for an autoloader; unreleased. Its own version line, release candidates `X.Y.Z-RC.N`; the README and the changelog name the crate release each version carries |
| Language | PHP 8.2+, one file, `bin/curly-lint`, with `declare(strict_types=1)`; no extension |
| Build | none here: `pack.sh` puts the commands beside the launcher in a git repository of its own, archives its tag as GitHub serves the mirror's to Composer, and has Composer install that archive from a Composer repository of the one version; the commands are those of the wheels `build.yml` builds, for Linux the ones linked statically against musl |
| Platforms | Linux and macOS on x86-64 and ARM64, Windows on x86-64, each command named by what PHP reports there, `commands/curly-lint-<PHP_OS_FAMILY>-<php_uname('m')>`, `.exe` on Windows; on any other the launcher holds no command, says so and exits 2 |
| Tests | `tests/launcher.php`, in the standard library alone, in `build-php.yml`, over the package as Composer installs it from the packed archive: on Linux and Windows with each PHP from 8.2 to 8.6, on macOS with the two ends, on Windows on ARM with the newest; on Linux and macOS over a second install, unpacked by ext-zip, which loses each file's mode; `rust/tests/cli.rs` against the installed launcher on the two ends, and on Linux a run in Alpine beside the runner's glibc |
| Lint | php-cs-fixer and PHPStan at level max, from `tools/qa/` (its own `composer.lock`, for PHP 8.2), `composer validate --strict`, ASCII-only `bin/curly-lint` and `tests/*.php`, all run by `build-php.yml`'s Package job on the packed tree |
| Runtime dependencies | none: the package requires PHP alone |
| Licenses | `LICENSE`, a copy of the root's, and `THIRD-PARTY-NOTICES.md` in the package, both held by `tests.yml`: the notices to the rows and the texts of the Python package's, so a crate the binary gains is a row in each |
| CI | `tests-php.yml` (calls `build-php.yml`, which calls `build.yml`; filtered by path, so never a required check), the `php` leg of `bench.yml`, `publish-php.yml` |

Commands, run from the root:

| Command | What it does |
|---------|--------------|
| `npm ci` | install from the lockfile |
| `npm test` | build, the core included, typecheck the source and the shipped declarations, lint, then the suite against the source and against the build, for every workspace — what CI runs |
| `npm run test:bun`, `npm run test:deno` | build, then the suite on Bun or Deno, for every workspace — what the runtime legs of CI run |
| `npm run bench --workspace <path>` | build, then the workspace's benchmark (`<path>/bench/rows.mjs`) |
| `npm run bench --workspace <path> -- --compare <dir>` | the same, beside the workspace checked out and built at `<dir>` — what `bench.yml` runs on a PR |
| `npm run lint:fix` | fix what the formatting contract reports |

Commands, run from `python/`:

| Command | What it does |
|---------|--------------|
| `uv venv .build && uv pip install --python .build --require-hashes -r build-constraints.txt` | the build tools, as CI installs them |
| `.build/bin/python build.py build --release --locked -o dist`, `.build/bin/python build.py sdist -o dist` | the wheel for this machine, and the sdist (`--target` and `--zig --compatibility manylinux_2_17` as `build.yml` passes them) |
| `python -I tests/dist.py dist <platform tag>` | hold what the build wrote to what the package ships |
| `CURLY_LINT_BIN=<installed curly-lint> cargo test -p curly-message-lint --locked --test cli`, from `rust/` | `cli.rs` against an installed wheel's command |
| `sh bench/prepare.sh && node bench/harness.mjs` | build and install into `bench/`, then the benchmark (`bench/rows.mjs`) |
| `node bench/harness.mjs --compare <dir>` | the same, beside the package prepared at `<dir>` — what `bench.yml` runs on a PR |

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

Commands, run from `go/`:

| Command | What it does |
|---------|--------------|
| `sh bench/prepare.sh && node bench/harness.mjs` | build the crate's command for this machine into `cmd/curly-lint/bin/`, pack the module with it, install the launcher from that into `bench/dist/`, then the benchmark (`bench/rows.mjs`) |
| `node bench/harness.mjs --compare <dir>` | the same, beside the package prepared at `<dir>` — what `bench.yml` runs on a PR |
| `go test ./...` | the launcher's tests, over the command `bench/prepare.sh` built |
| `gofmt -l .`, `go vet ./...`, `go mod tidy -diff` | the formatting and lint contract (`gofmt -w .` fixes the first) |
| `sh pack.sh <commands> <out>` | the module as a release serves it, with the commands `<commands>` holds: its tree, a proxy of it for `GOPROXY=file://`, and its `h1:` sum |
| `CURLY_LINT_BIN=<installed curly-lint> cargo test -p curly-message-lint --locked --test cli`, from `rust/` | `cli.rs` against an installed launcher |

Commands, run from `php/`:

| Command | What it does |
|---------|--------------|
| `sh bench/prepare.sh && node bench/harness.mjs` | build the crate's command for this machine into `commands/`, pack the package with it, have Composer install it from that into `bench/dist/`, then the benchmark (`bench/rows.mjs`) |
| `node bench/harness.mjs --compare <dir>` | the same, beside the package prepared at `<dir>` — what `bench.yml` runs on a PR |
| `php tests/launcher.php bench/dist` | the launcher's tests, over the package `bench/prepare.sh` installed |
| `composer install -d tools/qa`, `tools/qa/vendor/bin/php-cs-fixer fix --dry-run --diff`, `tools/qa/vendor/bin/phpstan analyse` | the formatting and lint contract (`fix` without `--dry-run` fixes the first) |
| `sh pack.sh <commands> <out>` | the package as a release serves it, with the commands `<commands>` holds: its tree, a Composer repository of its archive, and what it recorded of both |
| `node tools/p2.mjs <answer> <version>` | the commit and the archive Packagist's metadata names for a version, as `publish-php.yml` reads them |
| `CURLY_LINT_BIN=<bench/dist/vendor/bin/curly-lint> cargo test -p curly-message-lint --locked --test cli`, from `rust/` | `cli.rs` against the installed launcher |

`fixtures/` at the root is the linter's contract as data, for every
implementation: JSON cases of a message, a list of entries or a catalogue
file's text, each with its findings, and the plural rules a case is read with
in place of the host's; `fixtures/schema.json` is their schema and
`fixtures/README.md` says what a runner does.

Each workspace's `bench/rows.mjs` lists the rows of its benchmark, each read
off the build. `bench/harness.mjs` at the root measures them for both,
`bench/check/` beside it holds the rows it is checked on, and both are the same
in every repository of the family. `rust/bench/`, `python/bench/`,
`go/bench/` and `php/bench/` hold their own copies of both, which `tests.yml`
holds to the root's, and rows that read a release build: the crate's over a
child process, the Python package's wheel, sdist and installed command, the
Go module's zip and installed launcher, and the Composer package's archive
and installed launcher.

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
- `python/README.md` is the PyPI page and names, with `python/CHANGELOG.md`,
  the crate release the package carries; `python/THIRD-PARTY-NOTICES.md`
  lists what the native command holds, the CLDR's data, the Rust standard
  library and what each platform links in among it, and ships in every
  wheel.
- `go/README.md` is the page pkg.go.dev shows and names, with
  `go/CHANGELOG.md`, the crate release the module carries;
  `go/THIRD-PARTY-NOTICES.md` lists what the six commands hold, as the
  Python package's does of the same binaries, and the module holds it.
- `php/README.md` is the page Packagist shows and names, with
  `php/CHANGELOG.md`, the crate release the package carries;
  `php/THIRD-PARTY-NOTICES.md` lists what the five commands hold, as the
  Python package's does of the same binaries, and the package holds it.
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
