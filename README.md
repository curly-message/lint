# Lint

A linter for the [Curly Message Format](https://github.com/curly-message/spec).
Nothing in the format fails loudly: a placeholder that never closes is text, a
modifier nobody registered takes the fallback chain, a plural category nobody
wrote an option for renders whatever the chain holds. This finds them in the
text of a message or of a catalogue, before anyone renders it.

```
$ npx curly-lint "locales/{locale}/{namespace}.json"
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| [`lint/`](./lint) | `@curly-message/lint` | The rules, a library over them, and the `curly-lint` command for JSON catalogues: the crate compiled to WebAssembly, for Node, Bun and Deno. |
| [`eslint-plugin/`](./eslint-plugin) | `@curly-message/eslint-plugin` | The rules a single message decides, as ESLint rules, for JSON and for messages in JavaScript and TypeScript. |
| [`rust/`](./rust) | `curly-message-lint` | The rules, the catalogue reader and the `curly-lint` command in Rust: a crate and a native program, released as a prerelease, and the code the npm packages run. |

The library's README lists every rule. The command line runs all of them,
those that compare one locale with another included. The plugin runs the ones a
single message decides, since ESLint hands a rule one file at a time.

The rules are written once, in the crate. `rust/wasm/` binds it for
WebAssembly, and the library's build compiles that and holds it in its
bundle, so `npm test`, `npm run bench` and a release each need Rust with the
`wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
beside Node.

[`fixtures/`](./fixtures) is the linter's contract as data: messages, lists of
entries and catalogue files, each with the findings a linter answers for it,
and the plural rules it is read with in place of the host's. The library's
suite and the crate's each run every case, the library's through the crate it
holds compiled to WebAssembly, and the set's README says what a
runner in another language does with it.

Issues are filed in the family's shared tracker,
[`curly-message/spec`](https://github.com/curly-message/spec/issues).

## Benchmarks

`npm run bench --workspace <path>` measures what a workspace's build costs:
counts, such as what linting a catalogue reads of it, sizes, and times. A PR
that touches a workspace is benchmarked against its base by `bench.yml`,
which posts a table per workspace on the PR (a PR from a fork finds it in the
job's summary). A count that grew, a row gone missing or changing kind, or a
row that fails on the base fails the check unless the PR carries the
`bench-accepted` label; adding or removing the label runs it again. The
crate is measured the same way, by the commands its README names.

## Releasing

A workspace's release is cut from `main` by the **Publish** workflow
(`.github/workflows/publish.yml`, started by hand with the workspace to
publish and the kind of release). A workspace's changelog's pending section
names the version it will be released as — `### 1.1.0 (Unreleased)` — so a
version is settled in the commit that writes the section rather than in the
dispatch. `patch`, `minor` and `major` cut that section under the `latest`
dist-tag, and the run is refused unless the bump arrives at the version the
section names. `next` publishes a prerelease of that same version —
`1.1.0-next.0`, then `.1` — under the `next` dist-tag and leaves the section
open. The workflow runs the test matrix, bumps the version, cuts the section
where the release closes it, builds, the library's core compiled from clean
by the runner's stable Rust, which the library's `BENCH.md` names, writes the
benchmark of the build into
the workspace's `BENCH.md`, commits, tags (`lint-v1.1.0`,
`eslint-plugin-v1.1.0`), pushes, publishes to npm, and publishes a GitHub
release carrying that changelog section.

The plugin pins the library exactly, so the two release together: the library
first, then a plugin version whose pin names it.

After the tests, the release runs in three jobs, so that no code a dependency
ships runs where the release's credentials are: one settles the version, one
installs, builds and benchmarks with no credential that can push or publish,
and the last takes that build as files. Of the three, only the second runs a
dependency's code, and only the last holds the credentials, in the `release`
environment.

A release that stops after its tag exists is finished by **Re-run failed
jobs** on its run, before any further release of the workspace and within 30
days of the run or the build artifact's retention, whichever ends first: the
re-run reuses the run's version and build, makes the same commit, finds it
tagged, pushes nothing, and publishes to npm and to GitHub what is not there
yet. Re-running all jobs does not finish it, since a new build writes another
benchmark than the tag holds. A release that stops before its tag exists is
dispatched again, and cuts the same version. A publish that fails saying the
version is published already, right after npm took it, is re-run once more. A
release that cannot be finished this way — a defect in the workflow's own
steps after the push, or a run past that window — stays as far as it got, its
tag and whatever npm took, and the next version is released.

The commit, the tag and the release are made as a GitHub App, whose client ID
and private key the repository holds as the `APP_CLIENT_ID` variable and the
`APP_PRIVATE_KEY` secret; kept in the `release` environment alone, which only
`main` can deploy to, the key is out of every other job's reach. npm holds no
token: the workflow is each package's
[trusted publisher](https://docs.npmjs.com/trusted-publishers), registered,
with `release` as its environment, in the package's settings on npmjs.com or
by naming it to
`npm trust github @curly-message/lint --file publish.yml --repository curly-message/lint --environment release --allow-publish`,
then the same for `@curly-message/eslint-plugin`.
A trusted publisher can be registered only for a package that exists, so the
first version of each, `1.0.0-next.0`, was published by hand from `main` by a
maintainer of the scope (`npm ci && npm run build && npm publish --workspace lint --access public --tag next`,
then the same for `eslint-plugin`); the workflow refuses to run for a package
the registry does not know.

### The crate

The crate is released by the **Rust publish** workflow
(`.github/workflows/publish-rust.yml`, started by hand with the kind of
release), reading `rust/CHANGELOG.md`'s pending section and the release types
as the workspaces' workflow does. crates.io has no dist-tags: `next`
publishes a prerelease version (`1.1.0-next.0`, then `.1`), which Cargo
resolves only for a requirement that names a prerelease, as npm installs a
`next` version only when asked for it. The workflow runs the test matrix,
bumps `version` in `rust/Cargo.toml`, the crate's entry in `rust/Cargo.lock`
and the version `rust/README.md` installs, builds, writes the benchmark of
the release build into `rust/BENCH.md`, verifies the package (`cargo package`
builds the crate from the files it ships), commits, tags (`rust-v1.1.0`),
pushes, publishes to crates.io and publishes a GitHub release carrying the
changelog section, never marked as the repository's latest, which stays an
npm package's. It runs in the same three jobs, with the same App and the same
`release` environment, and the release job publishes only a crate whose
files hash as the verified one's did. A release of the crate that stops once
its tag exists is finished as a workspace's is, by re-running its failed
jobs, and a version crates.io holds already passes where its files hash as
the build's; one that stops before its tag exists is dispatched again.

crates.io holds no token: the workflow is the crate's
[trusted publisher](https://rust-lang.github.io/rfcs/3691-trusted-publishing-cratesio.html),
registered in the crate's settings on crates.io (repository owner
`curly-message`, repository `lint`, workflow `publish-rust.yml`, environment
`release`), and `rust-lang/crates-io-auth-action` exchanges the job's OIDC
token for a token it revokes when the job ends. A trusted publisher can be
registered only for a crate that exists, so the first version,
`1.0.0-next.0`, was published by hand from `main` by an owner with an API
token (`cd rust && cargo publish --locked -p curly-message-lint`); the
workflow refuses to run for a crate crates.io does not know.

## License

[MIT](./LICENSE)
