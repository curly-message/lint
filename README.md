# Lint

A linter for the [Curly Message Format](https://github.com/curly-message/spec).
Nothing in the format fails loudly: a placeholder that never closes is text, a
modifier nobody registered takes the fallback chain, a plural category nobody
wrote an option for renders whatever the chain holds. This finds them in the
text of a message or of a catalogue, before anyone renders it.

```
$ npx curly-lint locales
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| [`lint/`](./lint) | `@curly-message/lint` | The rules, a library over them, and the `curly-lint` command for JSON catalogues. |
| [`eslint-plugin/`](./eslint-plugin) | `@curly-message/eslint-plugin` | The rules a single message decides, as ESLint rules, for JSON and for messages in JavaScript and TypeScript. |

The library's README lists every rule. The command line runs all of them,
those that compare one locale with another included. The plugin runs the ones a
single message decides, since ESLint hands a rule one file at a time.

Issues are filed in the family's shared tracker,
[`curly-message/spec`](https://github.com/curly-message/spec/issues).

## Benchmarks

`npm run bench --workspace <path>` measures what a workspace's build costs:
counts, such as what linting a catalogue reads of it, sizes, and times. A PR
that touches a workspace is benchmarked against its base by `bench.yml`,
which posts a table per workspace on the PR (a PR from a fork finds it in the
job's summary). A count that grew, a row gone missing or changing kind, or a
row that fails on the base fails the check unless the PR carries the
`bench-accepted` label; adding or removing the label runs it again.

## Releasing

A release is cut from `main` by the **Publish** workflow
(`.github/workflows/publish.yml`, started by hand with the workspace to
publish and the kind of release). A workspace's changelog's pending section
names the version it will be released as — `### 1.1.0 (Unreleased)` — so a
version is settled in the commit that writes the section rather than in the
dispatch. `patch`, `minor` and `major` cut that section under the `latest`
dist-tag, and the run is refused unless the bump arrives at the version the
section names. `next` publishes a prerelease of that same version —
`1.1.0-next.0`, then `.1` — under the `next` dist-tag and leaves the section
open. The workflow runs the test matrix, bumps the version, cuts the section
where the release closes it, builds, writes the benchmark of the build into
the workspace's `BENCH.md`, commits, tags (`lint-v1.1.0`,
`eslint-plugin-v1.1.0`), pushes, publishes to npm, and publishes a GitHub
release carrying that changelog section.

The plugin pins the library exactly, so the two release together: the library
first, then a plugin version whose pin names it.

The commit, the tag and the release are made as a GitHub App, whose client ID
and private key the repository holds as the `APP_CLIENT_ID` variable and the
`APP_PRIVATE_KEY` secret. Its token is minted once the build is done, and no
dependency runs an install script in the job, so no dependency's code runs
while the token exists. npm holds no token: the workflow is each package's
[trusted publisher](https://docs.npmjs.com/trusted-publishers), registered in
the package's settings on npmjs.com or by naming it to
`npm trust github @curly-message/lint --file publish.yml --repository curly-message/lint --allow-publish`,
then the same for `@curly-message/eslint-plugin`.
A trusted publisher can be registered only for a package that exists, so the
first version of each, `1.0.0-next.0`, is published by hand from `main` by a
maintainer of the scope (`npm ci && npm run build && npm publish --workspace lint --access public --tag next`,
then the same for `eslint-plugin`); the workflow refuses to run for a package
the registry does not know.

## License

[MIT](./LICENSE)
