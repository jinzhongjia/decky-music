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
decky_stub.DECKY_PLUGIN_RUNTIME_DIR = "/tmp"
decky_stub.DECKY_PLUGIN_SETTINGS_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

import bridge as bridge_mod  # noqa: E402
from bridge import Bridge  # noqa: E402
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

    def test_radio_prev_noops_and_snapshot_hides_future_tracks(self):
        run(self.pb.play_radio("qq_guess", [item("a"), item("b"), item("c")]))
        run(self.pb.next_track())
        run(self.pb.prev_track())
        snap = self.pb.snapshot_queue()
        self.assertEqual(self.pb.index, 1)
        self.assertEqual(snap["mode"], "radio")
        self.assertEqual(snap["index"], 0)
        self.assertEqual([x["id"] for x in snap["items"]], ["b"])

    def test_radio_set_play_mode_ignored_and_clear_exits_radio(self):
        run(self.pb.play_radio("qq_guess", [item("a"), item("b")]))
        self.pb.set_play_mode("shuffle")
        self.assertEqual(self.pb.play_mode, "list_loop")
        run(self.pb.queue_clear())
        self.assertEqual((self.pb.mode, self.pb.queue, self.pb.index), ("normal", [], -1))

    def test_radio_queue_edits_are_ignored_except_clear(self):
        run(self.pb.play_radio("qq_guess", [item("a"), item("b"), item("c")]))
        run(self.pb.next_track())
        run(self.pb.queue_remove(0))
        run(self.pb.queue_insert_next(item("x")))
        run(self.pb.queue_append(item("y")))
        run(self.pb.queue_play(0))
        self.assertEqual(self.pb.mode, "radio")
        self.assertEqual(self.pb.index, 1)
        self.assertEqual([x["id"] for x in self.pb.queue], ["a", "b", "c"])

    def test_provider_switch_clears_radio_state(self):
        async def scenario():
            saved = []
            br = Bridge()
            br.settings = {"provider": "qq", "play_mode": "list_loop"}
            br.provider = FakeConn()
            br.player = FakeConn()
            br.playback = Playback(
                br.player, br.provider, persist=lambda q, i: saved.append((list(q), i))
            )
            await br.playback.play_radio("qq_guess", [item("a"), item("b")])

            ensured = []

            async def ensure_provider(which):
                ensured.append(which)

            old_save_settings = bridge_mod.save_settings
            bridge_mod.save_settings = lambda settings: saved.append(("settings", dict(settings)))
            br._ensure_provider = ensure_provider
            try:
                await br.set_provider("ncm")
            finally:
                bridge_mod.save_settings = old_save_settings

            self.assertEqual(ensured, ["ncm"])
            self.assertEqual((br.playback.mode, br.playback.queue, br.playback.index), ("normal", [], -1))

        run(scenario())

    def test_radio_ended_refills_near_tail_and_advances(self):
        calls = []

        async def fetch(kind):
            calls.append(kind)
            return [item("c")]

        async def scenario():
            pb = Playback(FakeConn(), FakeConn(), radio_fetcher=fetch)
            await pb.play_radio("qq_guess", [item("a"), item("b")])
            await pb.on_player_event(types.SimpleNamespace(ev="player", type="ended", data={}))
            await asyncio.sleep(0)
            self.assertEqual(calls, ["qq_guess"])
            self.assertEqual(pb.index, 1)
            self.assertEqual([x["id"] for x in pb.queue], ["a", "b", "c"])

        run(scenario())

    def test_radio_ended_advances_before_refill_finishes(self):
        calls = []
        gate = asyncio.Event()

        async def fetch(kind):
            calls.append(kind)
            await gate.wait()
            return [item("c")]

        async def scenario():
            pb = Playback(FakeConn(), FakeConn(), radio_fetcher=fetch)
            await pb.play_radio("qq_guess", [item("a"), item("b")])
            await pb.on_player_event(types.SimpleNamespace(ev="player", type="ended", data={}))
            await asyncio.sleep(0)
            self.assertEqual(calls, ["qq_guess"])
            self.assertEqual(pb.index, 1)
            self.assertEqual([x["id"] for x in pb.queue], ["a", "b"])
            gate.set()
            task = pb._radio_refill_task
            if task:
                await task
            self.assertEqual([x["id"] for x in pb.queue], ["a", "b", "c"])

        run(scenario())

    def test_radio_refill_is_single_flight(self):
        calls = []
        gate = asyncio.Event()

        async def fetch(kind):
            calls.append(kind)
            await gate.wait()
            return [item("c")]

        async def scenario():
            pb = Playback(FakeConn(), FakeConn(), radio_fetcher=fetch)
            await pb.play_radio("qq_guess", [item("a"), item("b")])
            t1 = asyncio.create_task(pb._refill_radio())
            await asyncio.sleep(0)
            t2 = asyncio.create_task(pb._refill_radio())
            await asyncio.sleep(0)
            self.assertEqual(calls, ["qq_guess"])
            gate.set()
            await asyncio.gather(t1, t2)
            self.assertEqual([x["id"] for x in pb.queue], ["a", "b", "c"])

        run(scenario())


if __name__ == "__main__":
    unittest.main()
