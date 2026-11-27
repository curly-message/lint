# curly-message-lint

[![PyPI](https://img.shields.io/pypi/v/curly-message-lint)](https://pypi.org/project/curly-message-lint/)
[![tests](https://github.com/curly-message/lint/actions/workflows/tests-python.yml/badge.svg?branch=main)](https://github.com/curly-message/lint/actions/workflows/tests-python.yml)

The `curly-lint` command, the linter for the
[Curly Message Format](https://github.com/curly-message/spec), for projects
that install their tools from PyPI. It finds what renders other than its
author meant in the messages of JSON catalogue files, before anyone renders
them.

```text
$ curly-lint "locales/{locale}/{namespace}.json"
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

The package holds the command alone, as a native program: the binary of the
Rust crate
[`curly-message-lint`](https://github.com/curly-message/lint/tree/main/rust),
built for each platform below. It runs no Python and has no Python API, so it
installs into any environment, whatever its Python. This version carries
the command of `curly-message-lint` 1.0.0, and the
[changelog](https://github.com/curly-message/lint/blob/main/python/CHANGELOG.md)
names the crate's version each release carries.

## Install

```sh
pipx install curly-message-lint
```

or `uv tool install curly-message-lint`, or `pip install curly-message-lint`
into a project's environment; `uvx --from curly-message-lint curly-lint`
runs it without installing it.

A wheel is published for each of:

| Platform | Wheel |
|----------|-------|
| Linux on x86-64 and on ARM64, with glibc 2.17 or newer | `manylinux_2_17_x86_64`, `manylinux_2_17_aarch64` |
| Linux on x86-64 and on ARM64, with musl 1.2 or newer, as Alpine has it | `musllinux_1_2_x86_64`, `musllinux_1_2_aarch64` |
| macOS 10.12 or newer on Intel, macOS 11 or newer on Apple silicon | `macosx_10_12_x86_64`, `macosx_11_0_arm64` |
| Windows on x86-64 and on ARM64 | `win_amd64`, `win_arm64` |

Each is tested on its platform before it is published. Elsewhere, the
installer builds the command from the sdist, with the Rust it finds on the
`PATH`, which is to be 1.88 or newer, or, where it finds none, with the
latest stable Rust that the build backend first installs into the user's
cache. That build is tested on Linux with Rust 1.88. On Windows it links the
C runtime into the command, as the wheels do, unless `RUSTFLAGS` or
`CARGO_ENCODED_RUSTFLAGS` is set, which takes the place of the flag that
does it.

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

`sh bench/prepare.sh && node bench/harness.mjs`, run from this directory
on Linux or macOS with [uv](https://docs.astral.sh/uv/), Rust and Node,
builds the wheel and the sdist for that machine, installs the wheel, and measures the size of
each, the files the wheel holds, and two times of the installed command.
`node bench/harness.mjs --compare <dir>` sets it beside the package prepared
the same way at `<dir>`.

## License

[MIT](https://github.com/curly-message/lint/blob/main/python/LICENSE). The
command holds the Unicode CLDR's plural rules and language aliases, under the
Unicode License v3, and the code it is built with under the terms
[THIRD-PARTY-NOTICES.md](https://github.com/curly-message/lint/blob/main/python/THIRD-PARTY-NOTICES.md)
lists; each wheel holds both files.
