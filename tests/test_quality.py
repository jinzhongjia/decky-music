"""音质上限:bridge 侧的持久化 + 传给 provider。

decky 是 Decky 运行时注入的模块,测试里打桩。
运行:python -m unittest tests.test_quality
"""

import asyncio
import logging
import os
import sys
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

import bridge as bridge_mod  # noqa: E402
import protocol  # noqa: E402
from bridge import DEFAULT_QUALITY, QUALITIES, Bridge  # noqa: E402
from playback import Playback  # noqa: E402


class TestSetQuality(unittest.TestCase):
    def setUp(self):
        self.b = Bridge()
        self.b.settings = {"version": 1, "quality": DEFAULT_QUALITY}
        self.saved = bridge_mod.save_settings
        self.written = []
        bridge_mod.save_settings = lambda s: self.written.append(dict(s))

    def tearDown(self):
        bridge_mod.save_settings = self.saved

    def test_valid_value_persists(self):
        got = asyncio.run(self.b.set_quality("lossless"))
        self.assertEqual(got, "lossless")
        self.assertEqual(self.b.settings["quality"], "lossless")
        self.assertEqual(self.written[-1]["quality"], "lossless")

    def test_invalid_value_is_rejected_without_writing(self):
        # 前端传垃圾不该把设置写坏,也不该落盘
        for bad in ("", "hires", "LOSSLESS", "320k"):
            got = asyncio.run(self.b.set_quality(bad))
            self.assertEqual(got, DEFAULT_QUALITY, f"bad={bad!r}")
        self.assertEqual(self.written, [])
        self.assertEqual(self.b.settings["quality"], DEFAULT_QUALITY)

    def test_default_is_the_old_hardcoded_cap(self):
        # 老用户升级后行为必须不变:默认档 = 改动前那个固定上限(320k)
        self.assertEqual(DEFAULT_QUALITY, "high")
        self.assertIn(DEFAULT_QUALITY, QUALITIES)


class _FakeConn:
    def __init__(self):
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append((cmd, args or {}))
        if cmd == "song_url":
            return protocol.ChildResponse(1, True, {"url": "http://x/y.mp3"}, None)
        return protocol.ChildResponse(1, True, {}, None)


class TestPlaybackSendsQuality(unittest.TestCase):
    def test_song_url_carries_the_cap(self):
        provider, player = _FakeConn(), _FakeConn()
        pb = Playback(player, provider, quality=lambda: "lossless")
        pb.queue = [{"id": "abc", "media_mid": "m", "name": "n", "singer": "s", "duration": 1}]
        asyncio.run(pb._play_index(0))
        cmd, args = provider.calls[0]
        self.assertEqual(cmd, "song_url")
        self.assertEqual(args["quality"], "lossless")

    def test_missing_reader_does_not_break_playback(self):
        # 没注入读取器(旧调用方/单测)时不能炸,让 provider 用它自己的默认档
        provider, player = _FakeConn(), _FakeConn()
        pb = Playback(player, provider)
        pb.queue = [{"id": "abc", "media_mid": "", "name": "n", "singer": "s", "duration": 1}]
        asyncio.run(pb._play_index(0))
        self.assertEqual(provider.calls[0][1]["quality"], "")


if __name__ == "__main__":
    unittest.main()
