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

import bridge as bridge_mod  # noqa: E402


def mode(path: str) -> int:
    return stat.S_IMODE(os.stat(path).st_mode)


class TestSaveSettingsPermissions(unittest.TestCase):
    def test_tmp_and_final_files_are_private_under_open_umask(self):
        old_umask = os.umask(0o000)
        old_settings = bridge_mod.SETTINGS
        old_replace = os.replace
        try:
            with tempfile.TemporaryDirectory() as d:
                bridge_mod.SETTINGS = os.path.join(d, "settings.json")
                seen = {}

                def checking_replace(src, dst):
                    seen["tmp_mode"] = mode(src)
                    old_replace(src, dst)

                os.replace = checking_replace
                bridge_mod.save_settings({"accounts": {"qq": {"cookie": "placeholder"}}})

                self.assertEqual(seen["tmp_mode"], 0o600)
                self.assertEqual(mode(bridge_mod.SETTINGS), 0o600)
                with open(bridge_mod.SETTINGS, encoding="utf-8") as f:
                    self.assertEqual(json.load(f)["accounts"]["qq"]["cookie"], "placeholder")
        finally:
            os.replace = old_replace
            bridge_mod.SETTINGS = old_settings
            os.umask(old_umask)

    def test_tmp_file_is_removed_when_replace_fails(self):
        old_settings = bridge_mod.SETTINGS
        old_replace = os.replace
        try:
            with tempfile.TemporaryDirectory() as d:
                bridge_mod.SETTINGS = os.path.join(d, "settings.json")
                tmp = bridge_mod.SETTINGS + ".tmp"

                def failing_replace(_src, _dst):
                    raise OSError("replace failed")

                os.replace = failing_replace
                with self.assertRaises(OSError):
                    bridge_mod.save_settings({"version": 1})
                self.assertFalse(os.path.exists(tmp))
        finally:
            os.replace = old_replace
            bridge_mod.SETTINGS = old_settings


if __name__ == "__main__":
    unittest.main()
