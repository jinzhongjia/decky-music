#!/usr/bin/env python3
"""Gate release ELF files/packages against the x86-64, glibc 2.39 baseline.

Requires Python's stdlib and GNU readelf (binutils); never executes input binaries.
Directories and tar archives must contain a real player/provider executable.
"""

import argparse
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

GLIBC_BASELINE = (2, 39)
SYSTEM_LIBRARIES = {"libc.so.6", "libm.so.6", "libgcc_s.so.1", "ld-linux-x86-64.so.2"}
MAIN_ROLES = {
    "player": "player",
    "player-linux-x64": "player",
    "ncm-provider": "ncm-provider",
    "ncm-provider-linux-x64": "ncm-provider",
    "qq-provider": "qq-provider",
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
    if role in {"player", "ncm-provider"}:
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


class Scan:
    def __init__(self):
        self.count = 0
        self.highest = ()
        self.mains = set()

    def add(self, path, name, mode=None):
        role = MAIN_ROLES.get(PurePosixPath(name).name)
        with path.open("rb") as source:
            is_elf = source.read(4) == b"\x7fELF"
        if not is_elf:
            if role:
                raise CheckError(f"{name}: main program is not ELF")
            return
        if role and mode is not None and not mode & 0o111:
            raise CheckError(f"{name}: main program lacks executable permission")
        try:
            highest = check_elf(path, role)
        except CheckError as error:
            raise CheckError(f"{name}: {error}") from error
        self.highest = max(self.highest, highest)
        self.count += 1
        if role:
            self.mains.add(name)

    def require_main(self):
        if not self.mains:
            raise CheckError(
                "package contains no executable player/provider main program"
            )

    def report(self, path):
        version = (
            ".".join(map(str, self.highest))
            if self.highest
            else "none (static/no versioned requirement)"
        )
        print(
            f"OK {path}: {self.count} x86-64 ELF(s), highest GLIBC requirement {version} (<= 2.39)"
        )


def check_directory(path, scan):
    root = path.resolve()

    def walk_error(error):
        raise CheckError(f"cannot scan package directory: {error}") from error

    for parent, directories, files in os.walk(
        root, followlinks=False, onerror=walk_error
    ):
        for name in directories + files:
            candidate = Path(parent, name)
            if candidate.is_symlink():
                try:
                    resolved = candidate.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise CheckError(
                        f"{candidate}: broken or cyclic package link"
                    ) from error
                if not resolved.is_relative_to(root):
                    raise CheckError(f"{candidate}: package link escapes directory")
                # Its real target is visited by os.walk; do not traverse links.
                continue
            if candidate.is_dir():
                continue
            if not candidate.is_file():
                raise CheckError(f"{candidate}: unsupported package file type")
            scan.add(
                candidate,
                candidate.relative_to(root).as_posix(),
                candidate.stat().st_mode,
            )
    scan.require_main()


def archive_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise CheckError(f"unsafe archive path: {name}")
    return path.as_posix()


def archive_members(archive):
    members = {}
    for member in archive.getmembers():
        name = archive_name(member.name)
        if name in members:
            raise CheckError(f"duplicate archive path: {name}")
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise CheckError(f"unsupported archive member: {name}")
        members[name] = member
    for name, member in members.items():
        for parent in PurePosixPath(name).parents:
            ancestor = members.get(parent.as_posix())
            if ancestor is not None and not ancestor.isdir():
                raise CheckError(f"archive path has a non-directory parent: {name}")
        if member.issym() or member.islnk():
            check_archive_link(name, members)
    return members


def check_archive_link(name, members):
    visited = set()
    while True:
        if name in visited:
            raise CheckError(f"cyclic archive link: {name}")
        visited.add(name)
        member = members.get(name)
        if member is None:
            raise CheckError(f"archive link target is missing: {name}")
        if not (member.issym() or member.islnk()):
            return
        target = member.linkname
        if member.issym():
            target = posixpath.join(posixpath.dirname(name), target)
        # Normalize an in-tree ../ symlink, but never permit escape or absolute paths.
        name = archive_name(posixpath.normpath(target))


def check_archive(path, scan):
    # Never extract archive paths or links. A single controlled scratch file is
    # necessary because readelf needs seeking; non-ELF resources stay in the archive.
    with (
        tarfile.open(path, "r:*") as archive,
        tempfile.TemporaryDirectory(prefix="decky-elf-") as temp,
    ):
        members = archive_members(archive)
        main = members.get("qq-provider/qq-provider")
        if main is None or not main.isfile():
            raise CheckError(
                "archive must contain regular qq-provider/qq-provider executable"
            )
        scratch = Path(temp, "elf")
        for name, member in members.items():
            if not member.isfile():
                continue
            with archive.extractfile(member) as source:
                magic = source.read(4)
                if magic != b"\x7fELF":
                    if name == "qq-provider/qq-provider":
                        raise CheckError(
                            "qq-provider/qq-provider: main program is not ELF"
                        )
                    continue
                with scratch.open("wb") as destination:
                    destination.write(magic)
                    shutil.copyfileobj(source, destination)
            scan.add(scratch, name, member.mode)
        scan.require_main()


def check_path(path):
    scan = Scan()
    if path.is_dir():
        check_directory(path, scan)
    elif not path.is_file():
        raise CheckError("input is not a regular file or directory")
    else:
        with path.open("rb") as source:
            magic = source.read(4)
        if magic == b"\x7fELF":
            # Downloaded release assets may be 0644 until the installer chmods them.
            scan.add(path, path.name)
        elif tarfile.is_tarfile(path):
            check_archive(path, scan)
        else:
            raise CheckError("input is neither ELF nor a tar archive")
    scan.report(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="+",
        type=Path,
        help="ELF file, standalone directory, or tar.gz archive",
    )
    args = parser.parse_args(argv)
    if shutil.which("readelf") is None:
        print("ERROR: readelf is required; install binutils", file=sys.stderr)
        return 1
    failed = False
    for path in args.paths:
        try:
            check_path(path)
        except (CheckError, OSError, RuntimeError, tarfile.TarError) as error:
            print(f"ERROR {path}: {error}", file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
