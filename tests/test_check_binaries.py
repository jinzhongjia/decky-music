"""Release baseline rejection boundaries; actual-ELF smoke uses check-binaries.py."""

import contextlib
import importlib.util
import io
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "check_binaries", Path(__file__).resolve().parents[1] / "scripts/check-binaries.py"
)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


def readelf_output(
    version="GLIBC_2.39", needed=("libc.so.6",), machine="Advanced Micro Devices X86-64"
):
    return "\n".join(
        [
            "ELF Header:",
            "  Class:                             ELF64",
            "  Data:                              2's complement, little endian",
            f"  Machine:                           {machine}",
            "  Type:                              DYN (Position-Independent Executable file)",
            "  Entry point address:               0x1000",
            *(f"  0x0000000000000001 (NEEDED) Shared library: [{name}]" for name in needed),
            "Version needs section '.gnu.version_r' contains 1 entry:",
            f"  0x0010: Name: {version} Flags: none Version: 2",
        ]
    )


class TestElfRequirements(unittest.TestCase):
    def test_glibc_numeric_ceiling_and_named_abi(self):
        self.assertEqual(checker.inspect_output(readelf_output("GLIBC_2.9")), (2, 9))
        self.assertEqual(checker.inspect_output(readelf_output()), (2, 39))
        self.assertEqual(checker.inspect_output(readelf_output("GLIBC_ABI_DT_RELR")), (2, 36))
        for version in ("GLIBC_2.40", "GLIBC_ABI_FUTURE", "GLIBC_PRIVATE"):
            with self.subTest(version=version), self.assertRaises(checker.CheckError):
                checker.inspect_output(readelf_output(version))

    def test_defined_glibc_versions_are_not_requirements(self):
        definitions = (
            "Version definition section '.gnu.version_d' contains 1 entry:\n"
            "  0x001c: Rev: 1 Flags: none Index: 2 Cnt: 1 Name: GLIBC_9.99\n"
        )
        self.assertEqual(checker.inspect_output(definitions + readelf_output()), (2, 39))

    def test_rejects_foreign_architecture(self):
        with self.assertRaises(checker.CheckError):
            checker.inspect_output(readelf_output(machine="AArch64"))

    def test_main_requires_entry_point(self):
        with self.assertRaises(checker.CheckError):
            checker.inspect_output(readelf_output().replace("0x1000", "0x0"), "qq-provider")

    def test_player_and_ncm_dynamic_dependency_boundaries(self):
        self.assertEqual(
            checker.inspect_output(
                readelf_output(needed=("libc.so.6", "libasound.so.2")), "player"
            ),
            (2, 39),
        )
        for role, library in (
            ("player", "libpulse.so.0"),
            ("player", "libssl.so.3"),
            ("ncm-provider", "libasound.so.2"),
            ("ncm-provider", "libcrypto.so.3"),
        ):
            with (
                self.subTest(role=role, library=library),
                self.assertRaises(checker.CheckError),
            ):
                checker.inspect_output(readelf_output(needed=(library,)), role)


class TestPackageGate(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_elf(self, path, version="GLIBC_2.39"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x7fELF" + version.encode())
        path.chmod(0o755)

    def readelf(self, command, **kwargs):
        version = Path(command[-1]).read_bytes()[4:].decode()
        return subprocess.CompletedProcess(command, 0, readelf_output(version), "")

    def cli(self, path):
        with (
            patch.object(checker.shutil, "which", return_value="/usr/bin/readelf"),
            patch.object(checker.subprocess, "run", side_effect=self.readelf),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()) as errors,
        ):
            status = checker.main([str(path)])
        return status, errors.getvalue()

    def make_archive(self, path, entries):
        with tarfile.open(path, "w:gz") as archive:
            for name, data, mode in entries:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = mode
                archive.addfile(member, io.BytesIO(data))

    def test_empty_directory_and_library_only_package_fail(self):
        self.assertEqual(self.cli(self.root)[0], 1)
        self.make_elf(self.root / "libpython.so")
        status, _ = self.cli(self.root)
        self.assertEqual(status, 1)

    def test_directory_checks_bundled_extension_not_only_main(self):
        self.make_elf(self.root / "qq-provider")
        library = self.root / "extensions" / "module.so"
        self.make_elf(library, "GLIBC_2.40")
        status, errors = self.cli(self.root)
        self.assertEqual(status, 1)
        self.assertIn("module.so", errors)
        self.make_elf(library, "GLIBC_2.28")
        self.assertEqual(self.cli(self.root)[0], 0)

    def test_executable_mode_required_for_package_not_download(self):
        main = self.root / "qq-provider"
        self.make_elf(main)
        main.chmod(0o644)
        self.assertEqual(self.cli(main)[0], 0)
        status, _ = self.cli(self.root)
        self.assertEqual(status, 1)

    def test_release_filenames_keep_dependency_policy(self):
        result = subprocess.CompletedProcess([], 0, readelf_output(needed=("libssl.so.3",)), "")
        for name in ("player-linux-x64", "ncm-provider-linux-x64"):
            with (
                self.subTest(name=name),
                patch.object(self, "readelf", return_value=result),
            ):
                binary = self.root / name
                self.make_elf(binary)
                status, _ = self.cli(binary)
                self.assertEqual(status, 1)

    def test_unreadable_subdirectory_does_not_silently_pass(self):
        self.make_elf(self.root / "qq-provider")

        (self.root / "private").mkdir()

        def walk(root, *, followlinks, onerror):
            yield str(root), ["private"], ["qq-provider"]
            onerror(PermissionError("private"))

        with patch.object(checker.os, "walk", side_effect=walk):
            status, _ = self.cli(self.root)
        self.assertEqual(status, 1)

    def test_archive_checks_all_elf_and_requires_main(self):
        archive = self.root / "qq-provider.tar.gz"
        main = ("qq-provider/qq-provider", b"\x7fELFGLIBC_2.39", 0o755)
        library = ("qq-provider/extensions/module.so", b"\x7fELFGLIBC_2.40", 0o644)
        self.make_archive(archive, [main, library])
        status, errors = self.cli(archive)
        self.assertEqual(status, 1)
        self.assertIn("module.so", errors)
        self.make_archive(archive, [library])
        self.assertEqual(self.cli(archive)[0], 1)
        self.make_archive(archive, [main])
        self.assertEqual(self.cli(archive)[0], 0)

    def test_archive_rejects_traversal_and_duplicate_members(self):
        archive = self.root / "qq-provider.tar.gz"
        main = ("qq-provider/qq-provider", b"\x7fELFGLIBC_2.39", 0o755)
        for entries in ([main, ("../escape", b"bad", 0o644)], [main, main]):
            with self.subTest(entries=entries):
                self.make_archive(archive, entries)
                self.assertEqual(self.cli(archive)[0], 1)

    def test_archive_rejects_escaping_symlink(self):
        archive_path = self.root / "qq-provider.tar.gz"
        with tarfile.open(archive_path, "w:gz") as archive:
            link = tarfile.TarInfo("qq-provider/libevil.so")
            link.type = tarfile.SYMTYPE
            link.linkname = "../../outside.so"
            archive.addfile(link)
        status, _ = self.cli(archive_path)
        self.assertEqual(status, 1)

    def test_directory_rejects_external_symlink(self):
        directory = self.root / "package"
        self.make_elf(directory / "qq-provider")
        self.make_elf(self.root / "external.so")
        (directory / "external.so").symlink_to(self.root / "external.so")
        status, _ = self.cli(directory)
        self.assertEqual(status, 1)


if __name__ == "__main__":
    unittest.main()
