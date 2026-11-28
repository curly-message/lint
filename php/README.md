# curly-lint for Composer

[![Packagist](https://img.shields.io/packagist/v/curly-message/lint)](https://packagist.org/packages/curly-message/lint)
[![tests](https://github.com/curly-message/lint/actions/workflows/tests-php.yml/badge.svg?branch=main)](https://github.com/curly-message/lint/actions/workflows/tests-php.yml)

The `curly-lint` command, the linter for the
[Curly Message Format](https://github.com/curly-message/spec), for projects
that install their tools with Composer. It finds what renders other than its
author meant in the messages of JSON catalogue files, before anyone renders
them.

```text
$ vendor/bin/curly-lint "locales/{locale}/{namespace}.json"
locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category
```

The package `curly-message/lint` holds the command alone, as a native
program: the binary of the Rust crate
[`curly-message-lint`](https://github.com/curly-message/lint/tree/main/rust),
built for each platform below, and a launcher in PHP, one file, that runs
the one for the platform PHP runs on. It has no PHP API, requires no package
and no extension, and loads nothing into a project's autoloader. This
version carries the command of `curly-message-lint` 1.0.0, and the
[changelog](https://github.com/curly-message/lint/blob/main/php/CHANGELOG.md)
names the crate's version each release carries.

The package is served from
[`curly-message/lint-php`](https://github.com/curly-message/lint-php), which
only the release workflow of
[`curly-message/lint`](https://github.com/curly-message/lint) writes to: each
version there is the `php/` directory of this repository at that version's
tag, but for its `BENCH.md`, with the commands built from the same tag, whose
SHA-256 the release's notes list. A change to the package is a pull request to
[`php/`](https://github.com/curly-message/lint/tree/main/php), and issues
are filed in the family's
[shared tracker](https://github.com/curly-message/spec/issues).

## Install

```sh
composer require --dev curly-message/lint
vendor/bin/curly-lint "locales/{locale}/{namespace}.json"
```

It takes PHP 8.2 or newer. While the package has no stable version, Composer
installs a release candidate only where it is asked for one:
`composer require --dev "curly-message/lint:^1.0@RC"`.

The package holds the command for each of:

| Platform | `PHP_OS_FAMILY` | `php_uname('m')` | Command |
|----------|-----------------|------------------|---------|
| Linux on x86-64, with any C library or none, as it is linked statically | `Linux` | `x86_64` | `commands/curly-lint-Linux-x86_64` |
| Linux on ARM64, linked the same way | `Linux` | `aarch64` | `commands/curly-lint-Linux-aarch64` |
| macOS on Intel | `Darwin` | `x86_64` | `commands/curly-lint-Darwin-x86_64` |
| macOS on Apple silicon | `Darwin` | `arm64` | `commands/curly-lint-Darwin-arm64` |
| Windows on x86-64 | `Windows` | `AMD64` | `commands/curly-lint-Windows-AMD64.exe` |

Each is tested on its platform before it is published, through the launcher
as Composer installs it there. The launcher names the file by what the PHP
that runs it reports, the two middle columns, and a platform is one the
package supports where that file is there: on any other, a 32-bit PHP on
Windows among them, it says so and exits 2. A 32-bit PHP on a 64-bit Linux
reports the machine's architecture and runs the command, unless it is run
as `linux32` runs it, where it reports `i686`. PHP has no build for Windows
on ARM64, so the package holds no command for it.

The archive Composer downloads holds all five commands, about 2.5 MB, and
about 6 MB unpacked. The file names are those of this release candidate, and
may change before 1.0.0.

## How the command runs

The launcher runs the command where Composer put it, in
`vendor/curly-message/lint/commands/`, on its own standard streams, waits
for it and exits with its status. So a run costs one start of PHP before the
command's own, some tens of milliseconds where the command takes less than
one; a caller that wants none of it runs the file in that directory itself.

- **Arguments** reach the command as they are written, through no shell. On
  Windows, `vendor\bin\curly-lint` is a batch file Composer writes, and
  `cmd` reads its arguments before PHP does: it expands `%NAME%` and takes
  `^` and `&` for its own. `php vendor/bin/curly-lint` passes them unchanged
  on every system.
- **Ctrl-C** at a terminal reaches the command and the launcher alike. On
  Windows the launcher stays to exit with the command's status, and `cmd`,
  where the batch file started it, then asks whether to terminate the batch
  job: that question is `cmd`'s.
- **A signal sent to the launcher alone** ends it, and the command runs to
  its end without it.

The launcher makes one write: where the command has lost the mode it runs
by, it gives it back (`chmod 755`). Composer unpacks an archive with `unzip`
or `7z`, which keep a file's mode, and where it finds neither, with PHP's
own zip, which does not, and says so as it installs. The first run as the
user who installed repairs that. What it cannot repair is a `vendor/`
installed without `unzip` by one user and run by another, a build step run
as root for an image whose programs run as someone else, say: install where
`unzip` is, or run the command once as the user who installed.

## Exit status

0, 1 and 2 are the command's: no error found, an error found, and a run
that could not lint. The launcher exits 2 as well, with one line on standard
error that begins `curly-lint: `, where it cannot run the command:

- the PHP that runs it has `php_uname`, `proc_open` or `proc_close`
  disabled (`disable_functions`);
- the package holds no command for the platform;
- the command is not a program its user can run, by its mode, its owner or
  a mount that runs nothing (`noexec`), and `chmod` could not change that;
- PHP could not start the command, or could not read its exit status once
  it ran, as under a parent that ignores `SIGCHLD`.

Two things are PHP's and not the launcher's:

- A command ended by a signal sent to it alone exits the launcher with that
  signal's number, or that number plus 128 where the system wrote a core
  file: so 1 can be a hangup and 2 an interrupt, and never 0.
- Any other status is PHP ending without the command's: 255 is PHP's own
  fatal error, as where a function other than the three above is disabled.
  A file in `commands/` that has the mode of a program and is none is
  started as that PHP starts any process, and where PHP learns only from the
  child that it did not start, the status is the child's: 127, or the status
  of the shell some systems hand such a file to.

## The command line

```sh
vendor/bin/curly-lint "locales/{locale}/{namespace}.json"
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

`sh bench/prepare.sh && node bench/harness.mjs`, run from `php/` in a
checkout of [`curly-message/lint`](https://github.com/curly-message/lint) on
Linux or macOS with PHP, Composer, git, Rust and Node, builds the command
for that machine, packs the package with it as a release packs it with all
five, has Composer install it into a project from that, and measures the
size of the archive and of the launcher, the packages the project installed,
and three times of the installed command.
`node bench/harness.mjs --compare <dir>` sets it beside the package prepared
the same way at `<dir>`.

## License

[MIT](https://github.com/curly-message/lint/blob/main/php/LICENSE). The
command holds the Unicode CLDR's plural rules and language aliases, under the
Unicode License v3, and the code it is built with under the terms
[THIRD-PARTY-NOTICES.md](https://github.com/curly-message/lint/blob/main/php/THIRD-PARTY-NOTICES.md)
lists; the package holds both files.
