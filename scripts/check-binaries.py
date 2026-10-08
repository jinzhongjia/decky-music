#!/usr/bin/env python3
"""Gate release ELF files against the x86-64, glibc 2.39 baseline.

Requires Python's stdlib and GNU readelf (binutils); never executes input binaries.
Inputs are the player / provider executables (or their release-asset names).
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

GLIBC_BASELINE = (2, 39)
SYSTEM_LIBRARIES = {"libc.so.6", "libm.so.6", "libgcc_s.so.1", "ld-linux-x86-64.so.2"}
MAIN_ROLES = {
    "player": "player",
    "player-linux-x64": "player",
    "provider": "provider",
    "provider-linux-x64": "provider",
}
# DT_RELR's named ABI requirement first appeared in glibc 2.36. Unknown named
# requirements must fail closed rather than vanish from a numeric-version regex.
GLIBC_ABIS = {"GLIBC_ABI_DT_RELR": (2, 36)}


class CheckError(Exception):
    pass


def glibc_requirement(output):
    """Read requirements, not versions *defined* by a bundled shared library."""
    versions = []
    in_needs = False
    for line in output.splitlines():
        if re.match(r"Version \w+ section", line):
            in_needs = line.startswith("Version needs section")
        if not in_needs:
            continue
        for name in re.findall(r"\bName:\s+(GLIBC_\S+)", line):
            if name in GLIBC_ABIS:
                versions.append(GLIBC_ABIS[name])
            elif re.fullmatch(r"GLIBC_[0-9]+(?:\.[0-9]+)+", name):
                versions.append(tuple(map(int, name.removeprefix("GLIBC_").split("."))))
            else:
                raise CheckError(f"unsupported glibc ABI requirement: {name}")
    highest = max(versions, default=())
    if highest > GLIBC_BASELINE:
        raise CheckError(
            f"requires GLIBC_{'.'.join(map(str, highest))}, maximum is GLIBC_2.39"
        )
    return highest


def inspect_output(output, role=None):
    fields = dict(
        re.findall(
            r"^\s*(Class|Data|Machine|Type|Entry point address):\s*(.+)$",
            output,
            re.MULTILINE,
        )
    )
    if (
        fields.get("Class") != "ELF64"
        or fields.get("Machine") != "Advanced Micro Devices X86-64"
        or fields.get("Data") != "2's complement, little endian"
    ):
        raise CheckError("expected little-endian x86-64 ELF64")
    if role:
        entry = fields.get("Entry point address", "")
        if (
            fields.get("Type", "").split(" ", 1)[0] not in {"EXEC", "DYN"}
            or not re.fullmatch(r"0x[0-9a-fA-F]+", entry)
            or int(entry, 16) == 0
        ):
            raise CheckError(f"{role} is not an executable ELF with an entry point")
    needed = set(re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", output))
    if role in {"player", "provider"}:
        allowed = SYSTEM_LIBRARIES | ({"libasound.so.2"} if role == "player" else set())
        unexpected = needed - allowed
        if unexpected:
            raise CheckError(
                f"{role} has unsupported dynamic dependencies: {', '.join(sorted(unexpected))}"
            )
    return glibc_requirement(output)


def check_elf(path, role=None):
    result = subprocess.run(
        [
            "readelf",
            "--wide",
            "--file-header",
            "--dynamic",
            "--version-info",
            str(path),
        ],
        capture_output=True,
        check=False,
        text=True,
        env={**os.environ, "LC_ALL": "C"},
    )
    if result.returncode or result.stderr.strip():
        raise CheckError(
            f"readelf could not inspect ELF: {result.stderr.strip() or result.returncode}"
        )
    return inspect_output(result.stdout, role)


def check_path(path):
    if not path.is_file():
        raise CheckError("input is not a regular file")
    with path.open("rb") as source:
        if source.read(4) != b"\x7fELF":
            raise CheckError("input is not an ELF file")
    role = MAIN_ROLES.get(path.name)
    if role is None:
        raise CheckError("unknown binary name; expected player/provider or their release assets")
    # Downloaded release assets may be 0644 until the installer chmods them.
    highest = check_elf(path, role)
    version = ".".join(map(str, highest)) if highest else "none (static/no versioned requirement)"
    print(f"OK {path}: {role} x86-64 ELF, highest GLIBC requirement {version} (<= 2.39)")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="+",
        type=Path,
        help="player / provider ELF file or release asset",
    )
    args = parser.parse_args(argv)
    if shutil.which("readelf") is None:
        print("ERROR: readelf is required; install binutils", file=sys.stderr)
        return 1
    failed = False
    for path in args.paths:
        try:
            check_path(path)
        except (CheckError, OSError) as error:
            print(f"ERROR {path}: {error}", file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
