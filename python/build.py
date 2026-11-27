"""Runs maturin with the arguments given, as every build of this package runs it.

`python build.py build --release --locked ...` or `python build.py sdist ...`,
from python/, with the Python maturin is installed in. Unless `RUSTFLAGS`
or `CARGO_ENCODED_RUSTFLAGS` is set, which replaces them, the paths of this
machine are written as names in what it compiles, as `lint/build-core.mjs`
writes them, so that the bytes do not depend on where they were built.
"""

import json
import os
import pathlib
import subprocess
import sys
import tomllib

root = pathlib.Path(__file__).resolve().parent.parent
home = pathlib.Path.home()
remapped = {
    f"{root}{os.sep}": "lint/",
    os.environ.get("CARGO_HOME") or str(home / ".cargo"): "cargo",
    os.environ.get("RUSTUP_HOME") or str(home / ".rustup"): "rustup",
}

# Flags of a `target.<cfg>` table, which cargo joins with the other tables
# that match, such as the one `pyproject.toml` writes for Windows; an
# environment's `RUSTFLAGS` would replace them all, and a `--config` on
# maturin's command line replaces those `pyproject.toml` names, so they are
# passed on beside it. maturin finds zig, which `ziglang` installs beside it,
# on the `PATH`.
arguments = sys.argv[1:]
if arguments[:1] == ["build"]:
    flags = json.dumps([f"--remap-path-prefix={path}={name}" for path, name in remapped.items()])
    configs = tomllib.loads((root / "python" / "pyproject.toml").read_text(encoding="utf-8"))["tool"]["maturin"]["config"]
    arguments += [argument for config in [*configs, f"target.'cfg(all())'.rustflags = {flags}"] for argument in ["--config", config]]
env = dict(os.environ, PATH=os.pathsep.join([str(pathlib.Path(sys.executable).parent), os.environ.get("PATH", "")]))

sys.exit(subprocess.run([sys.executable, "-m", "maturin", *arguments], cwd=root / "python", env=env, check=False).returncode)
