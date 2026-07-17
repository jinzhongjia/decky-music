"""clear_data 冒烟:settings 归默认 + liked_ids 清空 + 队列清理异常不挡数据清除。
异步子进程依赖打桩为 no-op。运行:python -m unittest tests/test_clear_data.py"""

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
decky_stub.DECKY_PLUGIN_LOG_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

import bridge as bridge_mod  # noqa: E402


class _FakeConn:
    async def request(self, *_a, **_k):
        return None


def _make_bridge(playback):
    b = bridge_mod.Bridge()
    b.settings = {"provider": "qq", "accounts": {"qq": {"cookie": "x"}}, "volume": 0.3}
    b.liked_ids = {"a", "b"}
    b.provider = _FakeConn()
    b.player = _FakeConn()
    b.playback = playback
    return b


class TestClearData(unittest.TestCase):
    def _run(self, playback):
        events = []
        saved = []
        playback.events = events
        b = _make_bridge(playback)
        old_save = bridge_mod.save_settings

        def fake_save(data):
            events.append("save")
            saved.append(dict(data))

        bridge_mod.save_settings = fake_save
        try:
            asyncio.run(b.clear_data())
        finally:
            bridge_mod.save_settings = old_save
        return b, events, saved

    def test_resets_and_persists_defaults_after_queue_clear(self):
        class _P:
            events = None

            async def queue_clear(self):
                self.events.append("qc")

            def set_play_mode(self, mode):
                self.mode_set = mode
                return True

        p = _P()
        b, events, saved = self._run(p)

        self.assertIsNone(b.settings["provider"])
        self.assertNotIn("accounts", b.settings)
        self.assertEqual(b.settings["volume"], 0.8)
        self.assertEqual(b.settings["play_mode"], "list_loop")
        self.assertEqual(b.liked_ids, set())
        self.assertEqual(p.mode_set, "list_loop")
        # 排序:queue_clear 必须在最终落盘之前(否则会把队列写回默认之后)
        self.assertEqual(events, ["qc", "save"])
        # 真的落盘了,且落的是干净默认
        self.assertTrue(saved)
        self.assertIsNone(saved[-1].get("provider"))
        self.assertNotIn("accounts", saved[-1])

    def test_queue_clear_failure_does_not_block_reset(self):
        class _P:
            events = None

            async def queue_clear(self):
                self.events.append("qc")
                raise RuntimeError("player not connected")

            def set_play_mode(self, mode):
                self.mode_set = mode
                return True

        p = _P()
        b, events, saved = self._run(p)

        # queue_clear 抛了,但数据仍被清除并落盘(凭证不能残留)
        self.assertNotIn("accounts", b.settings)
        self.assertIsNone(b.settings["provider"])
        self.assertEqual(b.liked_ids, set())
        self.assertTrue(saved)
        self.assertNotIn("accounts", saved[-1])


if __name__ == "__main__":
    unittest.main()
