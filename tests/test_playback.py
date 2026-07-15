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

    def test_resume_after_restore_cold_starts_current(self):
        # 重启回灌后 player 没 load 过:resume 应加载当前曲(而非发空操作 resume)
        self.pb.restore({"items": [item("a"), item("b")], "index": 1})
        run(self.pb.resume())
        self.assertTrue(self.pb.playing)
        self.assertEqual(self.pb.index, 1)
        self.assertIn("load", self.pb.player.calls)
        self.assertNotIn("resume", self.pb.player.calls)

    def test_resume_after_play_is_plain_resume(self):
        run(self.pb.play_queue([item("a")], 0))
        self.pb.player.calls.clear()
        run(self.pb.resume())
        self.assertEqual(self.pb.player.calls, ["resume"])

    def test_resume_on_empty_queue_noops_gracefully(self):
        run(self.pb.resume())
        self.assertEqual(self.pb.player.calls, ["resume"])  # 直通空操作,不崩

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


class TestSongsToItems(unittest.TestCase):
    """bridge 边界映射:provider Song 形状(mid)→ 队列项形状(id)。P5d 电台回归。"""

    def test_maps_mid_to_id_and_filters_junk(self):
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        from py_modules.bridge import _songs_to_items  # noqa: PLC0415

        items = _songs_to_items(
            [
                {"mid": "9", "name": "n", "singer": "s", "cover": "c", "duration": 7},
                {"name": "no-mid"},
                "junk",
            ]
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "9")
        self.assertEqual(items[0]["media_mid"], "")

    def test_non_list_returns_empty(self):
        from py_modules.bridge import _songs_to_items  # noqa: PLC0415

        self.assertEqual(_songs_to_items(None), [])


class TestRadioSongShapeRegression(unittest.TestCase):
    """回归:电台队列项缺 id(旧 bug 是 Song 形状直灌)不再 KeyError,走失败路径。"""

    def test_play_index_tolerates_missing_id(self):
        pb = Playback(FakeConn(), FakeConn())
        pb.queue = [{"name": "song-without-id"}]
        res = run(pb._play_index(0))
        self.assertTrue(res)  # FakeConn 对任意 id 都返回成功;重点是不抛 KeyError


class RecordingConn:
    """记录 (cmd, args) 的假 provider,验证分页参数逐层透传。"""

    def __init__(self):
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append((cmd, args))
        return types.SimpleNamespace(ok=True, data={}, error=None)


class TestListCmdPaging(unittest.TestCase):
    def setUp(self):
        self.bridge = Bridge.__new__(Bridge)  # 不 start():只测 callable → provider 参数
        self.bridge.provider = RecordingConn()

    def test_asset_offset_passthrough(self):
        run(self.bridge.get_fav_songs(50))
        self.assertEqual(self.bridge.provider.calls[0], ("fav_songs", {"limit": 50, "offset": 50}))

    def test_search_keyword_and_offset_passthrough(self):
        run(self.bridge.search_songs("k", 100))
        self.assertEqual(
            self.bridge.provider.calls[0],
            ("search_songs", {"limit": 50, "keyword": "k", "offset": 100}),
        )


class FlakyAuthConn:
    """song_url 先报 no_playable,凭证刷新后放行(模拟 musickey 会话中途过期)。"""

    def __init__(self):
        self.calls = []
        self.refreshed = False

    async def request(self, cmd, args=None):
        self.calls.append(cmd)
        if cmd == "song_url" and not self.refreshed:
            err = types.SimpleNamespace(code="no_playable", message="no_playable")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)


class VipOnlyConn:
    """指定 id 恒不可播(真 VIP 歌),其余正常。"""

    def __init__(self, blocked):
        self.blocked = set(blocked)
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append((cmd, (args or {}).get("id")))
        if cmd == "song_url" and (args or {}).get("id") in self.blocked:
            err = types.SimpleNamespace(code="no_playable", message="no_playable")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)


class TestAuthRetryAndRadioSkip(unittest.TestCase):
    def test_no_playable_refresh_then_retry_succeeds(self):
        conn = FlakyAuthConn()

        async def refresh():
            conn.refreshed = True
            return True

        pb = Playback(FakeConn(), conn, auth_retry=refresh)
        run(pb.play_queue([item("a")], 0))
        self.assertTrue(pb.playing)
        self.assertEqual(conn.calls.count("song_url"), 2)  # 失败 → 刷新 → 重试成功

    def test_no_refresh_means_no_retry(self):
        conn = FlakyAuthConn()

        async def refresh():
            return False  # 凭证没过期:真无版权,不浪费第二发

        pb = Playback(FakeConn(), conn, auth_retry=refresh)
        run(pb.play_queue([item("a")], 0))
        self.assertFalse(pb.playing)
        self.assertEqual(conn.calls.count("song_url"), 1)

    def test_radio_start_skips_unplayable_first_song(self):
        conn = VipOnlyConn(blocked=["a"])
        pb = Playback(FakeConn(), conn)
        res = run(pb.play_radio("qq_guess", [item("a"), item("b")]))
        self.assertTrue(res)
        self.assertEqual(pb.index, 1)  # 首歌 VIP 被跳过,第二首开播
        self.assertTrue(pb.playing)

    def test_radio_advance_skips_unplayable(self):
        conn = VipOnlyConn(blocked=["b"])
        pb = Playback(FakeConn(), conn)
        run(pb.play_radio("qq_guess", [item("a"), item("b"), item("c")]))
        run(pb.next_track())  # a 播完 → b 不可播 → 跳到 c
        self.assertEqual(pb.index, 2)
        self.assertTrue(pb.playing)


class SlowNetPlayer:
    """load 恒报 fetch_timeout(慢网首开超时),其余命令成功。"""

    def __init__(self):
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append(cmd)
        if cmd == "load":
            err = types.SimpleNamespace(code="fetch_timeout", message="fetch_timeout")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={}, error=None)


class TestAutoAdvanceFuse(unittest.TestCase):
    def test_ended_fuses_on_fetch_timeout(self):
        """慢网熔断:播完自动切歌遇 fetch_timeout 只试一首,不逐首撞 21s 重试。"""
        player = SlowNetPlayer()
        pb = Playback(player, FakeConn())
        pb.queue = [item("a"), item("b"), item("c")]
        pb.index = 0
        run(pb._on_ended())
        self.assertEqual(player.calls.count("load"), 1)
        self.assertFalse(pb.playing)
        self.assertEqual(pb.last_error, "fetch_timeout")

    def test_radio_start_fuses_on_fetch_timeout(self):
        player = SlowNetPlayer()
        pb = Playback(player, FakeConn())
        res = run(pb.play_radio("qq_guess", [item("a"), item("b"), item("c")]))
        self.assertFalse(res)
        self.assertEqual(player.calls.count("load"), 1)


class OfflinePlayer:
    """load 恒报 fetch_failed(断网/坏 URL),其余命令成功。"""

    def __init__(self):
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append(cmd)
        if cmd == "load":
            err = types.SimpleNamespace(code="fetch_failed", message="fetch_failed")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={}, error=None)


def _capture_events(pb_coro):
    """跑协程并收集 decky.emit 的事件 payload。"""
    import playback as playback_mod

    events = []

    async def rec(_name, payload):
        events.append(payload)

    old = playback_mod.decky.emit
    playback_mod.decky.emit = rec
    try:
        run(pb_coro)
    finally:
        playback_mod.decky.emit = old
    return events


class TestAutoAdvancePolish(unittest.TestCase):
    def test_two_consecutive_fetch_failed_fuse(self):
        """断网:fetch_failed 连续 2 次熔断,不把整个队列扫一圈。"""
        player = OfflinePlayer()
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abcde"]
        pb.index = 0
        run(pb._on_ended())
        self.assertEqual(player.calls.count("load"), 2)
        self.assertFalse(pb.playing)

    def test_shuffle_skip_always_finds_playable(self):
        """随机模式顺延用一次性乱序:多首不可播也必然找到唯一可播的那首。"""
        conn = VipOnlyConn(blocked=["a", "b", "d"])
        pb = Playback(FakeConn(), conn, play_mode="shuffle")
        pb.queue = [item(c) for c in "abcd"]
        pb.index = 0
        run(pb._on_ended())
        self.assertTrue(pb.playing)
        self.assertEqual(pb.queue[pb.index]["id"], "c")

    def test_skip_is_quiet_until_success(self):
        """跳过不可播的歌不逐首发 error;成功接上后 UI 只看到 track 事件。"""
        conn = VipOnlyConn(blocked=["b"])
        pb = Playback(FakeConn(), conn)
        pb.queue = [item("a"), item("b"), item("c")]
        pb.index = 0
        events = _capture_events(pb._on_ended())
        self.assertEqual([e["type"] for e in events if e["type"] == "error"], [])
        self.assertTrue(pb.playing)

    def test_give_up_emits_single_error(self):
        """整圈都不可播:放弃时只报一次错,不刷一串横幅。"""
        conn = VipOnlyConn(blocked=["a", "b", "c"])
        pb = Playback(FakeConn(), conn)
        pb.queue = [item("a"), item("b"), item("c")]
        pb.index = 0
        events = _capture_events(pb._on_ended())
        errs = [e for e in events if e["type"] == "error"]
        self.assertEqual(len(errs), 1)
        self.assertEqual(errs[0]["data"]["code"], "no_playable")
        self.assertFalse(pb.playing)
