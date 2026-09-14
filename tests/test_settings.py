"""settings.json persistence permissions."""

import json
import logging
import os
import stat
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

# ---- 打桩 decky(必须在 import bridge 前) ----
decky_stub = types.ModuleType("decky")
decky_stub.DECKY_PLUGIN_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_RUNTIME_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_SETTINGS_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

import music_settings


def mode(path: str) -> int:
    return stat.S_IMODE(os.stat(path).st_mode)


class TestSaveSettingsPermissions(unittest.TestCase):
    def test_tmp_and_final_files_are_private_under_open_umask(self):
        old_umask = os.umask(0o000)
        old_settings = music_settings.SETTINGS
        old_replace = os.replace
        try:
            with tempfile.TemporaryDirectory() as d:
                music_settings.SETTINGS = os.path.join(d, "settings.json")
                seen = {}

                def checking_replace(src, dst):
                    seen["tmp_mode"] = mode(src)
                    old_replace(src, dst)

                os.replace = checking_replace
                music_settings.save_settings({"accounts": {"qq": {"cookie": "placeholder"}}})

                self.assertEqual(seen["tmp_mode"], 0o600)
                self.assertEqual(mode(music_settings.SETTINGS), 0o600)
                with open(music_settings.SETTINGS, encoding="utf-8") as f:
                    self.assertEqual(json.load(f)["accounts"]["qq"]["cookie"], "placeholder")
        finally:
            os.replace = old_replace
            music_settings.SETTINGS = old_settings
            os.umask(old_umask)

    def test_tmp_file_is_removed_when_replace_fails(self):
        old_settings = music_settings.SETTINGS
        old_replace = os.replace
        try:
            with tempfile.TemporaryDirectory() as d:
                music_settings.SETTINGS = os.path.join(d, "settings.json")
                tmp = music_settings.SETTINGS + ".tmp"

                def failing_replace(_src, _dst):
                    raise OSError("replace failed")

                os.replace = failing_replace
                with self.assertRaises(OSError):
                    music_settings.save_settings({"version": 1})
                self.assertFalse(os.path.exists(tmp))
        finally:
            os.replace = old_replace
            music_settings.SETTINGS = old_settings


class TestSettingsNormalization(unittest.TestCase):
    def test_malformed_shapes_restore_safe_configuration(self):
        from playback import Playback

        malformed = [None, [], "text", 3, True, {"version": 2}, {"version": True}]
        malformed += [
            {"provider": ["qq"], "accounts": [], "queue": "bad", "volume": value}
            for value in (True, "0.4", float("nan"), float("inf"), -1, 2)
        ]
        for value in malformed:
            with self.subTest(value=value):
                normalized = music_settings.normalize_settings(value)
                pb = Playback(None, None, normalized["play_mode"])
                pb.restore(normalized["queue"])
                self.assertIsNone(normalized["provider"])
                self.assertEqual(normalized["volume"], 0.8)
                self.assertEqual(pb.snapshot_queue()["items"], [])
                self.assertFalse(pb.snapshot()["playing"])

    def test_nonempty_queue_bad_index_is_safe_and_does_not_autoplay(self):
        from playback import Playback

        for index in (None, {}, "1", True, float("nan"), -3, 99):
            with self.subTest(index=index):
                pb = Playback(None, None)
                pb.restore(
                    {
                        "items": [None, {"id": "a", "duration": float("inf")}, {"id": "b"}],
                        "index": index,
                    }
                )
                self.assertEqual(pb.snapshot()["current"]["id"], "a")
                self.assertEqual(pb.snapshot()["current"]["duration"], 0)
                self.assertFalse(pb.playing)

    def test_private_save_preserves_credentials_but_excludes_play_urls(self):
        from unittest.mock import patch

        secret_url = "https://example.invalid/audio?token=synthetic-private-token"
        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "settings.json")
            with patch.object(music_settings, "SETTINGS", target):
                with open(target + ".tmp", "w"):
                    pass
                os.chmod(target + ".tmp", 0o666)
                music_settings.save_settings(
                    {
                        "version": 1,
                        "provider": "qq",
                        "accounts": {"qq": {"cookie": "synthetic-cookie"}, "ncm": "synthetic-ncm"},
                        "queue": {"items": [{"id": "a", "url": secret_url}], "index": 0},
                        "url": secret_url,
                    }
                )
                with open(target, encoding="utf-8") as stream:
                    text = stream.read()
                self.assertNotIn(secret_url, text)
                self.assertEqual(mode(target), 0o600)
                self.assertEqual(
                    music_settings.load_settings()["accounts"]["qq"]["cookie"], "synthetic-cookie"
                )

    def test_modes_and_numeric_metadata_are_normalized_without_losing_valid_fields(self):
        data = music_settings.normalize_settings(
            {
                "version": 1,
                "provider": "ncm",
                "volume": 0.25,
                "play_mode": {},
                "queue_mode": [],
                "quality": ["lossless"],
                "queue": {"items": [{"id": "a", "name": [], "duration": True}], "index": 0},
            }
        )
        self.assertEqual((data["provider"], data["volume"]), ("ncm", 0.25))
        self.assertEqual(
            (data["play_mode"], data["queue_mode"], data["quality"]),
            ("list_loop", "normal", "high"),
        )
        self.assertEqual(data["queue"]["items"][0]["duration"], 0)
        self.assertEqual(data["queue"]["items"][0]["name"], "")

    def test_invalid_json_load_falls_back_without_exposing_file_content(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "settings.json")
            with open(target, "w") as stream:
                stream.write('{"cookie": "synthetic-secret"')
            with patch.object(music_settings, "SETTINGS", target):
                self.assertEqual(music_settings.load_settings()["accounts"], {})


if __name__ == "__main__":
    unittest.main()
