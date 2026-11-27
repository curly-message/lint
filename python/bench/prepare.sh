#!/bin/sh
# Writes, from python/, what bench/rows.mjs reads: the wheel and the sdist in
# bench/dist/, and the wheel installed into bench/.venv/. With a directory, it
# takes the wheel and the sdist built there, as a release measures what it
# publishes; without one, it builds both for this machine, as every build of
# the package does. A benchmark workflow runs it on each side of a comparison.
set -e

rm -rf bench/dist bench/.venv bench/.build
mkdir bench/dist

if [ -n "$1" ]; then
  cp "$1"/*.whl "$1"/*.tar.gz bench/dist/
else
  uv venv --quiet bench/.build
  uv pip install --quiet --python bench/.build --require-hashes -r build-constraints.txt
  bench/.build/bin/python build.py build --release --locked -o bench/dist
  bench/.build/bin/python build.py sdist -o bench/dist
fi

uv venv --quiet bench/.venv
uv pip install --quiet --python bench/.venv --no-index --no-deps bench/dist/*.whl
