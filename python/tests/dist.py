"""Holds what a build of this package wrote to what it is to ship.

    python -I tests/dist.py <dir> <platform tag>

run from python/: `<dir>` holds the build's wheel, and its sdist where the
build wrote one. The wheel is to be named for this project and its version,
tagged `py3-none-<platform tag>`, and hold the command, the metadata, the two
license files and the SBOM, and nothing else; a Windows command is to import
no DLL of a C runtime, which a clean Windows lacks; every component the SBOM names
is a row of the notices; the sdist is to hold the license files and the
crate's source. Standard library only, so it runs before anything is
installed.
"""

import json
import pathlib
import re
import stat
import sys
import tarfile
import tomllib
import zipfile

directory, platform = pathlib.Path(sys.argv[1]), sys.argv[2]
project = tomllib.loads(pathlib.Path("pyproject.toml").read_text(encoding="utf-8"))["project"]
stem = f"{project['name'].replace('-', '_')}-{project['version']}"
failures = []


def check(holds, message):
    if not holds:
        failures.append(message)


def imports(image):
    """The DLLs a PE image's import table names."""
    header = int.from_bytes(image[0x3C:0x40], "little")
    sections, optional = (int.from_bytes(image[header + offset : header + offset + 2], "little") for offset in (6, 20))
    directories = header + 24 + (112 if image[header + 24 : header + 26] == b"\x0b\x02" else 96)
    table = header + 24 + optional

    def at(rva):
        for section in range(sections):
            entry = table + 40 * section
            size, address, _, raw = (int.from_bytes(image[entry + offset : entry + offset + 4], "little") for offset in (8, 12, 16, 20))
            if address <= rva < address + size:
                return raw + rva - address
        raise ValueError(f"no section holds the address {rva:#x}")

    names = []
    descriptor = at(int.from_bytes(image[directories + 8 : directories + 12], "little"))
    while any(image[descriptor : descriptor + 20]):
        name = at(int.from_bytes(image[descriptor + 12 : descriptor + 16], "little"))
        names.append(image[name : image.index(b"\0", name)].decode("ascii"))
        descriptor += 20
    return names


wheels = sorted(directory.glob("*.whl"))
check([wheel.name for wheel in wheels] == [f"{stem}-py3-none-{platform}.whl"], f"{directory} holds the wheels {[wheel.name for wheel in wheels]}, not {stem}-py3-none-{platform}.whl alone.")

for wheel in wheels:
    with zipfile.ZipFile(wheel) as archive:
        entries = {entry.filename: entry for entry in archive.infolist()}
        script = f"{stem}.data/scripts/curly-lint{'.exe' if platform.startswith('win') else ''}"
        info = f"{stem}.dist-info"
        expected = {script, *(f"{info}/{name}" for name in ["METADATA", "WHEEL", "RECORD", "licenses/LICENSE", "licenses/THIRD-PARTY-NOTICES.md", "sboms/curly-message-lint.cyclonedx.json"])}
        check(set(entries) == expected, f"{wheel.name} holds {sorted(set(entries) ^ expected)} where it is to hold {sorted(expected)}.")

        if script in entries and not platform.startswith("win"):
            check(stat.S_IMODE(entries[script].external_attr >> 16) & 0o111 == 0o111, f"{script} is not executable.")

        if script in entries and platform.startswith("win"):
            runtime = sorted(name for name in imports(archive.read(script)) if name.lower().startswith(("vcruntime", "msvcp", "api-ms-win-crt-")))
            check(not runtime, f"{script} imports {runtime}, the C runtime a clean Windows lacks.")

        metadata = archive.read(f"{info}/METADATA").decode()
        check("\nRequires-Python:" not in metadata, "METADATA states a Python the wheel requires, which runs none.")
        check(f"\nLicense-Expression: {project['license']}\n" in metadata, f"METADATA states another license than {project['license']}.")

        notices = archive.read(f"{info}/licenses/THIRD-PARTY-NOTICES.md").decode()
        check(notices == pathlib.Path("THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8"), "The wheel's notices are not THIRD-PARTY-NOTICES.md.")
        rows = set(re.findall(r"^\| \[`([^`]+)`\]", notices, re.M))
        sbom = json.loads(archive.read(f"{info}/sboms/curly-message-lint.cyclonedx.json"))
        named = {component["name"] for component in sbom.get("components", [])}
        check(bool(named) and named <= rows, f"The SBOM names {sorted(named - rows)}, which THIRD-PARTY-NOTICES.md lists no row for.")

for sdist in sorted(directory.glob("*.tar.gz")):
    check(sdist.name == f"{stem}.tar.gz", f"{directory} holds the sdist {sdist.name}, not {stem}.tar.gz.")
    with tarfile.open(sdist) as archive:
        names = {name.removeprefix(f"{stem}/") for name in archive.getnames()}
    required = {"PKG-INFO", "pyproject.toml", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "rust/Cargo.toml", "rust/Cargo.lock", "rust/LICENSE", "rust/cldr/LICENSE", "rust/src/lib.rs", "rust/src/bin/curly-lint/main.rs"}
    check(required <= names, f"{sdist.name} lacks {sorted(required - names)}.")

for failure in failures:
    print(failure, file=sys.stderr)

sys.exit(1 if failures else 0)
