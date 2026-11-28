# Changelog

## 1.0.1

The `curly-lint` command of the Rust crate `curly-message-lint` 1.0.0, as
1.0.0 carries it.

* **A command another run placed is never replaced.** A run that found the
  command missing and wrote it while another placed it renamed its copy
  over the other's; it now leaves it as it is. A path that holds what is not
  the command is still written over, and on a file system with no hard
  links, Linux and macOS still rename the command into place.

## 1.0.0

The first version: the `curly-lint` command of the Rust crate
`curly-message-lint` 1.0.0, as the Go module
`github.com/curly-message/lint-go`, which holds the command built for Linux,
macOS and Windows, each on x86-64 and on ARM64, and a launcher that the go
command installs or runs as a project's tool.
