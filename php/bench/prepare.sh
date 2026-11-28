#!/bin/sh
# Writes, from php/, what bench/rows.mjs reads, into bench/dist/: `repo/`, a
# Composer repository that serves the package as a release does, whose
# archive the size row weighs, and beside it a project that requires the
# package from that repository, as Composer installs it: `vendor/bin/` holds
# the launcher the command's rows start. With a directory, it takes the
# repository there, as a release measures what it publishes; without one, it
# builds the crate's command for this machine into commands/, under the name
# the launcher looks for here, and packs the package with that one command. A
# benchmark workflow runs it on each side of a comparison.
set -e

name=$(sed -n 's/^    "name": "\(.*\)",$/\1/p' composer.json)
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)

rm -rf bench/dist
mkdir bench/dist
dist=$(cd bench/dist && pwd)

if [ -n "$1" ]; then
  cp -R "$1" bench/dist/repo
else
  target=$(cd ../rust && cargo metadata --format-version 1 --no-deps --locked | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).target_directory")

  # A release ships stripped commands, and a profile written in Cargo.toml
  # would ship in the crate.
  (cd ../rust && CARGO_PROFILE_RELEASE_STRIP=true cargo build --release --locked -p curly-message-lint --bin curly-lint)

  mkdir -p commands
  cp "$target/release/curly-lint" "commands/$(php -r 'echo "curly-lint-", PHP_OS_FAMILY, "-", php_uname("m");')"

  sh pack.sh commands bench/dist/pack
  mv bench/dist/pack/repo bench/dist/repo
  rm -rf bench/dist/pack
fi

# The repository names its archive by where it was written.
sed -i.moved "s|\"url\": \"file://[^\"]*\"|\"url\": \"file://$dist/repo/lint.zip\"|" bench/dist/repo/packages.json
rm bench/dist/repo/packages.json.moved

# From that repository alone, and past Composer's cache: see pack.sh.
printf '{"repositories": [{"type": "composer", "url": "file://%s/repo"}, {"packagist.org": false}]}\n' "$dist" > bench/dist/composer.json
(cd bench/dist && composer require --quiet --no-interaction --no-cache --no-plugins "$name:$version")
