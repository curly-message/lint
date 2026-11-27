#!/bin/sh
# Packs, from go/, the module as a release serves it, and has the go command
# fetch it: `sh pack.sh <commands> <out>` writes into <out>
#
#   tree/         what the mirror holds at the version's tag: this directory's
#                 files but BENCH.md, which a release measures on this very
#                 tree, and under cmd/curly-lint/bin/ each native command
#                 <commands> holds, named curly-lint-<GOOS>-<GOARCH>[.exe]
#   proxy/        a module proxy of that one version, for GOPROXY=file://
#   module.json   what `go mod download -json` answered: the version and the
#                 `h1:` sum the checksum database records for that tree
#
# The version is package.json's. The go command reads the tree from a git
# repository, as it reads the mirror, so the zip is the one a proxy builds.
set -e

commands=$(cd "$1" && pwd)
mkdir -p "$2"
out=$(cd "$2" && pwd)

module=$(sed -n 's/^module //p' go.mod)
version=v$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)

rm -rf "$out/tree" "$out/proxy" "$out/cache" "$out/module.json"
mkdir -p "$out/tree/cmd/curly-lint/bin"

# The files git holds here or would take: a local tree may be dirty.
git ls-files -z --cached --others --exclude-standard -- . ':(exclude)BENCH.md' | tar -cf - --null -T - | tar -xf - -C "$out/tree"
cp "$commands"/curly-lint-* "$out/tree/cmd/curly-lint/bin/"
# A file of the tree like any other: the launcher makes its copy a program.
chmod 644 "$out/tree/cmd/curly-lint/bin/"*

git -C "$out/tree" init --quiet
git -C "$out/tree" add --all --force
git -C "$out/tree" -c user.name=pack -c user.email=pack@localhost commit --quiet --message "$version"
git -C "$out/tree" tag "$version"

# A module cache of its own: the version packed here is not the one a
# release of the same number serves, and must not be found in its place.
cd "$out"
GOMODCACHE=$out/cache GOFLAGS=-modcacherw GOWORK=off GOPROXY=direct GONOSUMDB=$module GONOPROXY= GOPRIVATE= GOINSECURE= \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.file://$out/tree.insteadOf" GIT_CONFIG_VALUE_0="https://$module" \
  go mod download -json "$module@$version" > module.json

# What the go command unpacked is what was built: an attribute of the tree
# could rewrite a file between its commit and its zip.
for command in "$commands"/curly-lint-*; do
  cmp "$command" "cache/$module@$version/cmd/curly-lint/bin/$(basename "$command")"
done

cp -R cache/cache/download proxy
rm -rf cache proxy/sumdb
find proxy -name '*.lock' -exec rm {} +
