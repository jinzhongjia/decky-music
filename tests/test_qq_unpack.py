"""qq_exe 自解包单测:remote_binary 安装落的是 tar.gz 文件,bridge 首次用到时自解。"""

import io
import logging
import os
import stat
import sys
import tarfile
import tempfile
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

decky_stub = types.ModuleType("decky")
decky_stub.DECKY_PLUGIN_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_RUNTIME_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_SETTINGS_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)
# discover 跑全套时别的用例可能已装桩:后续属性补丁必须打在真正被 bridge 引用的那个模块上
decky_stub = sys.modules["decky"]

import bridge  # noqa: E402


def _make_tarball(path: str):
    """构造与 build-qq-provider.sh 同构的归档:顶层 qq-provider/ 目录含可执行。"""
    with tarfile.open(path, "w:gz") as tf:
        data = b"#!/bin/sh\n"
        info = tarfile.TarInfo("qq-provider/qq-provider")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))


class TestQqUnpack(unittest.TestCase):
    def setUp(self):
        self.plugin = tempfile.TemporaryDirectory()
        self.runtime = tempfile.TemporaryDirectory()
        self.bin = os.path.join(self.plugin.name, "bin")
        os.makedirs(self.bin)
        self._saved = (decky_stub.DECKY_PLUGIN_DIR, decky_stub.DECKY_PLUGIN_RUNTIME_DIR)
        decky_stub.DECKY_PLUGIN_DIR = self.plugin.name
        decky_stub.DECKY_PLUGIN_RUNTIME_DIR = self.runtime.name

    def tearDown(self):
        decky_stub.DECKY_PLUGIN_DIR, decky_stub.DECKY_PLUGIN_RUNTIME_DIR = self._saved
        os.chmod(self.bin, 0o755)
        self.plugin.cleanup()
        self.runtime.cleanup()

    def test_sideload_layout_passthrough(self):
        exe = os.path.join(self.bin, "qq-provider", "qq-provider")
        os.makedirs(os.path.dirname(exe))
        open(exe, "w").close()
        self.assertEqual(bridge.qq_exe(), exe)

    def test_unpacks_tarball_into_bin(self):
        _make_tarball(os.path.join(self.bin, "qq-provider"))
        exe = bridge.qq_exe()
        self.assertEqual(exe, os.path.join(self.bin, "qq-provider", "qq-provider"))
        self.assertTrue(os.path.isfile(exe))
        self.assertTrue(os.stat(exe).st_mode & stat.S_IXUSR)  # chmod +x
        # tar 文件已让位,重复调用幂等
        self.assertEqual(bridge.qq_exe(), exe)

    def test_missing_binary_returns_natural_path(self):
        # 什么都没有:返回常规路径,让 spawn 报出自然的 FileNotFoundError
        self.assertEqual(
            bridge.qq_exe(), os.path.join(self.bin, "qq-provider", "qq-provider")
        )


if __name__ == "__main__":
    unittest.main()
