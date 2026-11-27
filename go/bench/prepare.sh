#!/bin/sh
# Writes, from go/, what bench/rows.mjs reads, into bench/dist/: `proxy/`, a
# module proxy that serves the module as a release does, whose zip the size
# rows weigh, and `bin/`, the launcher the go command installs from it, as a
# project that installs the module builds it. With a directory, it takes the
# proxy there, as a release measures what it publishes; without one, it
# builds the crate's command for this machine into cmd/curly-lint/bin/, where
# the package embeds it from, and packs the module with that one command. A
# benchmark workflow runs it on each side of a comparison.
set -e

module=$(sed -n 's/^module //p' go.mod)
version=v$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)

rm -rf bench/dist
mkdir bench/dist

if [ -n "$1" ]; then
  cp -R "$1" bench/dist/proxy
else
  target=$(cd ../rust && cargo metadata --format-version 1 --no-deps --locked | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")

  # A release ships stripped commands, and a profile written in Cargo.toml
  # would ship in the crate.
  (cd ../rust && CARGO_PROFILE_RELEASE_STRIP=true cargo build --release --locked -p curly-message-lint --bin curly-lint)

  mkdir -p cmd/curly-lint/bin
  cp "$target/release/curly-lint$(go env GOEXE)" "cmd/curly-lint/bin/curly-lint-$(go env GOOS)-$(go env GOARCH)$(go env GOEXE)"

  sh pack.sh cmd/curly-lint/bin bench/dist/pack
  mv bench/dist/pack/proxy bench/dist/proxy
  rm -rf bench/dist/pack
fi

# Outside the module, as a project installs it, and through a module cache
# of its own: see pack.sh.
dist=$(cd bench/dist && pwd)
cd "$dist"
GOBIN=$dist/bin GOMODCACHE=$dist/cache GOFLAGS=-modcacherw GOWORK=off GOPROXY=file://$dist/proxy GONOSUMDB=$module \
  go install "$module/cmd/curly-lint@$version"
rm -rf cache
