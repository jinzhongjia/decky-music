"""log.py 日志目录清理/统计的纯逻辑。decky 是 Decky 运行时注入的模块,测试里打桩。
运行:python -m unittest tests/test_log_clear.py"""

import logging
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

# ---- 打桩 decky(必须在 import log 前) ----
decky_stub = types.ModuleType("decky")
decky_stub.DECKY_PLUGIN_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_RUNTIME_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_SETTINGS_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_LOG_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")
sys.modules.setdefault("decky", decky_stub)

import log as log_mod  # noqa: E402


class TestDirSize(unittest.TestCase):
    def test_sums_regular_files_only(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "a.log"), "w") as f:
                f.write("x" * 10)
            with open(os.path.join(d, "b.log"), "w") as f:
                f.write("y" * 5)
            os.mkdir(os.path.join(d, "sub"))  # 子目录不计
            self.assertEqual(log_mod.dir_size(d), 15)

    def test_missing_dir_is_zero(self):
        self.assertEqual(log_mod.dir_size("/no/such/dir/here"), 0)


class TestClearLogDir(unittest.TestCase):
    def test_truncates_files_to_zero_and_keeps_them(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "plugin.log")
            with open(p, "w") as f:
                f.write("noisy" * 100)
            log_mod.clear_log_dir(d)
            self.assertTrue(os.path.exists(p))  # 文件仍在
            self.assertEqual(os.path.getsize(p), 0)  # 已清空
            self.assertEqual(log_mod.dir_size(d), 0)

    def test_missing_dir_no_error(self):
        log_mod.clear_log_dir("/no/such/dir/here")  # 不抛


if __name__ == "__main__":
    unittest.main()
