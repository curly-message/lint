#!/bin/sh
# Builds, from rust/, what bench/rows.mjs reads, into bench/dist/:
# `curly-lint`, the command, whose stripped binary the size rows weigh and the
# command's rows start; `curly-message-lint-bench`, the program that runs the
# library's rows; and the `.crate` a release ships.
set -e

metadata=$(cargo metadata --format-version 1 --no-deps --locked)
target=$(printf '%s' "$metadata" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")
version=$(printf '%s' "$metadata" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).packages.find((p) => p.name === 'curly-message-lint').version")

# The size rows weigh stripped binaries, and a profile written in Cargo.toml
# would ship in the package.
export CARGO_PROFILE_RELEASE_STRIP=true

rm -rf bench/dist
mkdir bench/dist

cargo build --release --locked -p curly-message-lint --bin curly-lint
cargo build --release --locked -p curly-message-lint-bench
cp "$target/release/curly-lint" "$target/release/curly-message-lint-bench" bench/dist/

# The tests verify the package; this weighs it. A local tree may be dirty.
cargo package --locked --no-verify --allow-dirty -p curly-message-lint
cp "$target/package/curly-message-lint-$version.crate" bench/dist/curly-message-lint.crate
