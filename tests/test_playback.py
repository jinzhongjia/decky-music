"""playback 队列编辑单测(P4):插入/移除的索引账目、清空空态、持久化回调。

decky 是 Decky 运行时注入的模块,测试里打桩;player/provider 用假 Conn(鸭子类型)。
运行:python -m unittest tests/test_playback.py
"""

import asyncio
import logging
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "py_modules"))

# ---- 打桩 decky(必须在 import playback 前) ----
decky_stub = types.ModuleType("decky")
decky_stub.DECKY_PLUGIN_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

from playback import Playback  # noqa: E402


class FakeConn:
    """假 Conn:song_url / load / stop 全部成功。"""

    def __init__(self):
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append(cmd)
        return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)


def item(i: str) -> dict:
    return {"id": i, "media_mid": f"m{i}", "name": i, "singer": "", "cover": "", "duration": 1}


def run(coro):
    return asyncio.run(coro)


class TestQueueEdit(unittest.TestCase):
    def setUp(self):
        self.persisted = []
        self.pb = Playback(
            FakeConn(), FakeConn(), persist=lambda q, i: self.persisted.append((len(q), i))
        )

    def test_insert_next_after_current(self):
        run(self.pb.play_queue([item("a"), item("b")], 0))
        run(self.pb.queue_insert_next(item("c")))
        self.assertEqual([x["id"] for x in self.pb.queue], ["a", "c", "b"])
        self.assertEqual(self.pb.index, 0)

    def test_insert_next_on_empty_plays(self):
        run(self.pb.queue_insert_next(item("a")))
        self.assertEqual(self.pb.index, 0)
        self.assertTrue(self.pb.playing)

    def test_remove_before_current_shifts_index(self):
        run(self.pb.play_queue([item("a"), item("b"), item("c")], 1))
        run(self.pb.queue_remove(0))
        self.assertEqual(self.pb.index, 0)
        self.assertEqual([x["id"] for x in self.pb.queue], ["b", "c"])

    def test_remove_current_plays_next(self):
        run(self.pb.play_queue([item("a"), item("b")], 0))
        run(self.pb.queue_remove(0))
        self.assertEqual([x["id"] for x in self.pb.queue], ["b"])
        self.assertEqual(self.pb.index, 0)

    def test_remove_last_current_goes_empty(self):
        run(self.pb.play_queue([item("a")], 0))
        run(self.pb.queue_remove(0))
        self.assertEqual((self.pb.queue, self.pb.index, self.pb.playing), ([], -1, False))

    def test_clear_and_snapshot(self):
        run(self.pb.play_queue([item("a"), item("b")], 1))
        run(self.pb.queue_clear())
        snap = self.pb.snapshot_queue()
        self.assertEqual((snap["items"], snap["index"], snap["mode"]), ([], -1, "normal"))

    def test_restore_rich_fields_no_autoplay(self):
        self.pb.restore(
            {"items": [{"id": "a", "media_mid": "ma", "name": "歌A"}, {"id": "b"}], "index": 1}
        )
        self.assertEqual(self.pb.index, 1)
        self.assertFalse(self.pb.playing)
        self.assertEqual(self.pb.queue[0]["media_mid"], "ma")
        self.assertEqual(self.pb.queue[0]["name"], "歌A")
        self.assertEqual(self.pb.queue[1]["name"], "")  # 旧存档缺字段 → 空串占位

    def test_persist_called_on_edits(self):
        run(self.pb.play_queue([item("a")], 0))
        self.assertTrue(self.persisted)


if __name__ == "__main__":
    unittest.main()
