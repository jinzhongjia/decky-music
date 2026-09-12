"""Audio session selection must not connect to another user's runtime."""

import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "py_modules"))

from session_env import audio_environment


class TestAudioEnvironment(unittest.TestCase):
    def test_preserves_private_custom_runtime_and_parent_environment(self):
        with tempfile.TemporaryDirectory() as runtime:
            inherited = {
                "XDG_RUNTIME_DIR": runtime,
                "DBUS_SESSION_BUS_ADDRESS": "unix:abstract=custom-session",
            }
            with patch.dict(os.environ, inherited, clear=True):
                result = audio_environment()
                self.assertEqual(result, inherited)
                result["XDG_RUNTIME_DIR"] = "/changed-by-child"
                self.assertEqual(os.environ["XDG_RUNTIME_DIR"], runtime)

    def test_invalid_inherited_runtime_falls_back_to_non_default_uid(self):
        uid = 1207
        fallback = f"/run/user/{uid}"
        private = os.stat_result((stat.S_IFDIR | 0o700, 0, 0, 1, uid, uid, 0, 0, 0, 0))
        foreign = os.stat_result((stat.S_IFDIR | 0o700, 0, 0, 1, 0, 0, 0, 0, 0, 0))

        def runtime_stat(path):
            if path == fallback:
                return private
            if path == "/run/user/0":
                return foreign
            raise FileNotFoundError(path)

        for inherited in (
            {},
            {"XDG_RUNTIME_DIR": ""},
            {"XDG_RUNTIME_DIR": "relative"},
            {"XDG_RUNTIME_DIR": "/run/user/0"},
        ):
            with (
                self.subTest(inherited=inherited),
                patch.dict(os.environ, inherited, clear=True),
                patch("session_env.os.geteuid", return_value=uid),
                patch("session_env.os.stat", side_effect=runtime_stat),
            ):
                self.assertEqual(audio_environment()["XDG_RUNTIME_DIR"], fallback)

    def test_no_session_drops_invalid_runtime_instead_of_fabricating_one(self):
        with (
            patch.dict(os.environ, {"XDG_RUNTIME_DIR": "/missing"}, clear=True),
            patch("session_env.os.stat", side_effect=FileNotFoundError),
        ):
            self.assertNotIn("XDG_RUNTIME_DIR", audio_environment())

    def test_public_directory_and_regular_file_are_not_audio_runtimes(self):
        with tempfile.TemporaryDirectory() as root:
            public = Path(root) / "public"
            public.mkdir(mode=0o755)
            ordinary_file = Path(root) / "file"
            ordinary_file.touch(mode=0o700)
            for invalid in (str(public), str(ordinary_file)):
                with (
                    self.subTest(path=invalid),
                    patch.dict(os.environ, {"XDG_RUNTIME_DIR": invalid}, clear=True),
                ):
                    self.assertNotEqual(
                        audio_environment().get("XDG_RUNTIME_DIR"), invalid
                    )


if __name__ == "__main__":
    unittest.main()
