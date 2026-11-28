#!/bin/sh
# Packs, from php/, the package as a release serves it, and has Composer
# install it: `sh pack.sh <commands> <out>` writes into <out>
#
#   tree/         what the mirror holds at the version's tag: this directory's
#                 files but BENCH.md, which a release measures on this very
#                 tree, and under commands/ each native command <commands>
#                 holds, named as the launcher names it, by what PHP calls
#                 the platform: curly-lint-<PHP_OS_FAMILY>-<php_uname('m')>,
#                 with .exe on Windows
#   repo/         a Composer repository of that one version, for a project's
#                 `repositories`: lint.zip, the archive of the tag as GitHub
#                 serves it to Composer, and packages.json, which names it by
#                 a file:// URL of where it was written
#   package.json  the version, the tree's and the commit's ids, the archive's
#                 size and SHA-256, and the SHA-256 of each command
#
# The version is package.json's. A release holds all five commands; a
# directory with fewer packs a package for the platforms it holds.
set -e

commands=$(cd "$1" && pwd)
mkdir -p "$2"
out=$(cd "$2" && pwd)

name=$(sed -n 's/^    "name": "\(.*\)",$/\1/p' composer.json)
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)

rm -rf "$out/tree" "$out/repo" "$out/installed" "$out/package.json"
mkdir -p "$out/tree/commands" "$out/repo" "$out/installed"

# The files git holds here or would take: a local tree may be dirty.
git ls-files -z --cached --others --exclude-standard -- . ':(exclude)BENCH.md' | tar -cf - --null -T - | tar -xf - -C "$out/tree"

# The one place a platform's name is spelled out: the launcher builds the
# same name from what PHP reports, and holds no list.
held=0
for command in "$commands"/*; do
  case "$(basename "$command")" in
    curly-lint-Linux-x86_64|curly-lint-Linux-aarch64|curly-lint-Darwin-x86_64|curly-lint-Darwin-arm64) mode=755 ;;
    curly-lint-Windows-AMD64.exe) mode=644 ;;
    *) echo "pack.sh: $command is no command the package names." >&2; exit 1 ;;
  esac
  [ -f "$command" ] && [ -s "$command" ] || { echo "pack.sh: $command is no file, or an empty one." >&2; exit 1; }
  cp "$command" "$out/tree/commands/"
  # The file in the tree is the program a project runs.
  chmod "$mode" "$out/tree/commands/$(basename "$command")"
  held=$((held + 1))
done
[ "$held" -gt 0 ] || { echo "pack.sh: $commands holds no command." >&2; exit 1; }

git -C "$out/tree" init --quiet
git -C "$out/tree" add --all --force
git -C "$out/tree" -c user.name=pack -c user.email=pack@localhost commit --quiet --message "v$version"
git -C "$out/tree" tag "v$version"
commit=$(git -C "$out/tree" rev-parse "v$version^{commit}")

# A command but Windows's is held as a program: a file system or a
# `core.fileMode` that keeps no mode would pack one no project can run.
git -C "$out/tree" ls-tree "v$version" commands/ | while read -r held _ _ command; do
  case "$command" in *.exe) expected=100644 ;; *) expected=100755 ;; esac
  [ "$held" = "$expected" ] || { echo "pack.sh: $command is held with mode $held, not $expected." >&2; exit 1; }
done

# The zip of the tag, which leaves out what .gitattributes marks, under one
# directory, as the zipball Packagist points Composer to.
git -C "$out/tree" archive --format=zip --prefix="lint-php-$commit/" --output="$out/repo/lint.zip" "v$version"

php -r '
  [, $tree, $out, $version, $commit] = $argv;
  $flags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR;
  $zip = "$out/repo/lint.zip";
  $package = json_decode(file_get_contents("$tree/composer.json"), true, 16, JSON_THROW_ON_ERROR);
  $package += [
      "version" => "v$version",
      "dist" => ["type" => "zip", "url" => "file://$zip", "reference" => $commit, "shasum" => sha1_file($zip)],
  ];
  file_put_contents("$out/repo/packages.json", json_encode(["packages" => [$package["name"] => ["v$version" => $package]]], $flags) . "\n");
  $digests = [];
  foreach (glob("$tree/commands/*") as $command) {
      $digests[basename($command)] = hash_file("sha256", $command);
  }
  file_put_contents("$out/package.json", json_encode([
      "name" => $package["name"],
      "version" => $version,
      "tree" => trim(shell_exec("git -C " . escapeshellarg($tree) . " rev-parse HEAD^{tree}")),
      "commit" => $commit,
      "zip" => ["sha256" => hash_file("sha256", $zip), "size" => filesize($zip)],
      "commands" => $digests,
  ], $flags) . "\n");
' "$out/tree" "$out" "$version" "$commit"

# What Composer installs is what was built: an attribute of the tree could
# rewrite a file between its commit and its archive. From this repository
# alone, and past Composer's cache: the version packed here is not the one a
# release of the same number serves, and must not be found in its place.
printf '{"repositories": [{"type": "composer", "url": "file://%s"}, {"packagist.org": false}]}\n' "$out/repo" > "$out/installed/composer.json"
(cd "$out/installed" && composer require --quiet --no-interaction --no-cache --no-plugins "$name:$version")
for command in "$commands"/*; do
  cmp "$command" "$out/installed/vendor/$name/commands/$(basename "$command")"
done
rm -rf "$out/installed"
