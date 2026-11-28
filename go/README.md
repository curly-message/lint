# curly-lint for Go

[![Go Reference](https://pkg.go.dev/badge/github.com/curly-message/lint-go/cmd/curly-lint.svg)](https://pkg.go.dev/github.com/curly-message/lint-go/cmd/curly-lint)
[![tests](https://github.com/curly-message/lint/actions/workflows/tests-go.yml/badge.svg?branch=main)](https://github.com/curly-message/lint/actions/workflows/tests-go.yml)

The `curly-lint` command, the linter for the
[Curly Message Format](https://github.com/curly-message/spec), for projects
that install their tools with the go command. It finds what renders other
than its author meant in the messages of JSON catalogue files, before anyone
renders them.

```text
$ curly-lint "locales/{locale}/{namespace}.json"
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

The module `github.com/curly-message/lint-go` holds the command alone, as a
native program: the binary of the Rust crate
[`curly-message-lint`](https://github.com/curly-message/lint/tree/main/rust),
built for each platform below, and a launcher in Go that carries the one for
the platform it is built for, keeps it in the user's cache directory and
runs it. It has no Go API and requires no module. This version carries the
command of `curly-message-lint` 1.0.0, and the
[changelog](https://github.com/curly-message/lint/blob/main/go/CHANGELOG.md)
names the crate's version each release carries.

The module is served from
[`curly-message/lint-go`](https://github.com/curly-message/lint-go), which
only the release workflow of
[`curly-message/lint`](https://github.com/curly-message/lint) writes to: each
version there is the `go/` directory of `lint` at the tag `go-vX.Y.Z`, but
for its `BENCH.md`, with the commands built from that tag beside it. A change
to the package is a pull request to `lint`, and issues are filed in the
family's
[shared tracker](https://github.com/curly-message/spec/issues).

## Install

As a tool of a project, in its `go.mod`:

```sh
go get -tool github.com/curly-message/lint-go/cmd/curly-lint
go tool curly-lint "locales/{locale}/{namespace}.json"
```

or for a user, into `GOBIN`:

```sh
go install github.com/curly-message/lint-go/cmd/curly-lint@latest
```

Either takes Go 1.24 or newer. `go get -tool` is a flag of Go 1.24 itself,
which an older go command refuses, and it raises the `go` line of a project's
`go.mod` to 1.24 where it is lower, and may add a `toolchain` line.
`go install` leaves the project as it is, and run by Go 1.21 to 1.23 it
fetches a newer toolchain by itself, unless `GOTOOLCHAIN` names `local` or one
version alone; an older Go has to be upgraded. `go tool` answers with the
command's exit code.
`go run` does not: it answers 1 whenever the command answers 1 or 2, so a
job that tells findings from a run that linted nothing uses one of the two
above.

The module holds the command for each of:

| Platform | Command |
|----------|---------|
| Linux on x86-64 and on ARM64, with any C library or none, as it is linked statically | `linux/amd64`, `linux/arm64` |
| macOS on Intel and on Apple silicon, wherever the Go that builds the launcher runs | `darwin/amd64`, `darwin/arm64` |
| Windows on x86-64 and on ARM64 | `windows/amd64`, `windows/arm64` |

Each is tested on its platform before it is published, through the launcher
the go command builds there. Built for any other platform, Android and iOS
among them, the launcher holds no command: it says so and exits 2.

The module's zip holds all six commands, about 3 MB to download and about
7.5 MB unpacked, and a build takes the one for its platform. `go mod vendor`
copies all six into a project's `vendor/` directory, and leaves out
`THIRD-PARTY-NOTICES.md`, whose terms they come under: a project that
vendors the module carries that file itself.

## Where the command is kept

A program cannot be run from inside another, so the launcher writes the
command to a file on its first run and runs it from there on every run:
`curly-lint/<the command's SHA-256>/curly-lint` (`curly-lint.exe` on
Windows) in the user's cache directory (`$XDG_CACHE_HOME` or `~/.cache` on Linux, `~/Library/Caches` on
macOS, `%LocalAppData%` on Windows), or in the directory
`CURLY_LINT_CACHE_DIR` names. Every run holds the file to the bytes the
launcher carries, and writes it again where it differs or has lost the mode
it runs by. Where the command
cannot be kept or run, the launcher says why on standard error and exits 2.

- The directory has to be one programs run from: a container whose only
  writable directory is mounted `noexec` runs nothing from it.
- The directory has to be one only its user writes to, since the command is
  compared and then run.
- Each version of the command is kept under its own name, and nothing
  removes an older one: `curly-lint/` in the cache directory can be deleted
  at any time.

On Linux and macOS the command takes the launcher's place, so its streams,
signals and exit code are its own. On Windows the launcher waits for the
command and exits with its code; a launcher ended by force leaves the
command running to its end.

## The command line

```sh
curly-lint "locales/{locale}/{namespace}.json"
```

The command is the crate's, with the same arguments, report and exit codes.
`curly-lint --help` prints the arguments, the
[npm package's README](https://github.com/curly-message/lint/tree/main/lint#the-command-line)
says how a pattern reads a file's locale and namespace off its path, what the
report holds and what each exit code means, and the
[crate's README](https://github.com/curly-message/lint/tree/main/rust#the-command-line)
says how the native command differs from the npm package's: plural rules are
those of the Unicode CLDR 48 the crate carries, not those of a runtime's
`Intl`. The
[rules](https://github.com/curly-message/lint/tree/main/lint#rules) are
described in the npm package's README.

## Benchmark

`sh bench/prepare.sh && node bench/harness.mjs`, run from `go/` in a
checkout of [`curly-message/lint`](https://github.com/curly-message/lint) on
Linux or macOS with Go, git, Rust and Node, builds the command for that
machine, packs the module with it as a release packs it with all six, has
the go command install the launcher from that, and measures the size of the
module's zip and of the launcher, the modules the launcher is built from,
and three times of the installed command.
`node bench/harness.mjs --compare <dir>` sets it beside the package prepared
the same way at `<dir>`.

## License

[MIT](https://github.com/curly-message/lint/blob/main/go/LICENSE). The
command holds the Unicode CLDR's plural rules and language aliases, under the
Unicode License v3, and the code it is built with under the terms
[THIRD-PARTY-NOTICES.md](https://github.com/curly-message/lint/blob/main/go/THIRD-PARTY-NOTICES.md)
lists; the module holds both files.
