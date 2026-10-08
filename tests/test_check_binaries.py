"""Release baseline rejection boundaries; actual-ELF smoke uses check-binaries.py."""

import contextlib
import importlib.util
import io
import subprocess
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
            checker.inspect_output(readelf_output().replace("0x1000", "0x0"), "provider")

    def test_player_and_provider_dynamic_dependency_boundaries(self):
        self.assertEqual(
            checker.inspect_output(
                readelf_output(needed=("libc.so.6", "libasound.so.2")), "player"
            ),
            (2, 39),
        )
        for role, library in (
            ("player", "libpulse.so.0"),
            ("player", "libssl.so.3"),
            ("provider", "libasound.so.2"),
            ("provider", "libcrypto.so.3"),
        ):
            with (
                self.subTest(role=role, library=library),
                self.assertRaises(checker.CheckError),
            ):
                checker.inspect_output(readelf_output(needed=(library,)), role)


class TestReleaseGate(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_elf(self, path, version="GLIBC_2.39"):
        path.write_bytes(b"\x7fELF" + version.encode())
        path.chmod(0o644)  # Downloaded release assets are not executable yet.

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

    def test_known_names_pass_and_glibc_ceiling_applies(self):
        for name in ("player", "provider", "player-linux-x64", "provider-linux-x64"):
            with self.subTest(name=name):
                binary = self.root / name
                self.make_elf(binary)
                self.assertEqual(self.cli(binary)[0], 0)
                self.make_elf(binary, "GLIBC_2.40")
                self.assertEqual(self.cli(binary)[0], 1)

    def test_unknown_names_directories_and_non_elf_fail(self):
        unknown = self.root / "qq-provider"
        self.make_elf(unknown)
        self.assertEqual(self.cli(unknown)[0], 1)
        self.assertEqual(self.cli(self.root)[0], 1)
        text = self.root / "provider"
        text.write_text("not an elf")
        self.assertEqual(self.cli(text)[0], 1)

    def test_release_filenames_keep_dependency_policy(self):
        result = subprocess.CompletedProcess([], 0, readelf_output(needed=("libssl.so.3",)), "")
        for name in ("player-linux-x64", "provider-linux-x64"):
            with (
                self.subTest(name=name),
                patch.object(self, "readelf", return_value=result),
            ):
                binary = self.root / name
                self.make_elf(binary)
                status, _ = self.cli(binary)
                self.assertEqual(status, 1)


if __name__ == "__main__":
    unittest.main()
