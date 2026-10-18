"""Playback recovery and retry regressions."""

import asyncio
import types
import unittest
from tests.playback_support import FakeConn, item, run, _capture_events
from playback import Playback


class SeekTrackingConn:
    """记录 load / seek / stop,并可让 seek 失败(模拟上游不支持 Range)。"""

    def __init__(self, seek_ok=True):
        self.calls = []
        self.seeks = []
        self.seek_ok = seek_ok

    async def request(self, cmd, args=None, *, is_current=None):
        self.calls.append(cmd)
        if cmd == "seek":
            self.seeks.append((args or {}).get("sec"))
            if not self.seek_ok:
                err = types.SimpleNamespace(code="seek_failed", message="seek_failed")
                return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)


class TestResumeAfterStreamDeath(unittest.TestCase):
    """流中途彻底死掉后,按播放键要从中断处接上,而不是没反应 / 从头重放。

    stream.rs 已经会用 Range 从字节位置续传,但它退避重试 3 次仍无进展时会判死;
    此前 bridge 收到 error 只把 playing 置 False,_loaded 仍是 True —— resume() 于是
    往一个已死的 sink 发 resume,表现为「按播放键没反应」,而 self.pos 从没被用过。
    """

    def _died_at(self, player, pos=42.5, code="fetch_failed"):
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index = 1
        pb._loaded = True
        pb.playing, pb.pos = True, pos
        run(
            pb.on_player_event(
                types.SimpleNamespace(
                    ev="player", type="error", data={"code": code, "message": code}
                )
            )
        )
        return pb

    def test_error_marks_unloaded_and_remembers_position(self):
        pb = self._died_at(SeekTrackingConn())
        self.assertFalse(pb.playing)
        self.assertFalse(pb._loaded)  # 否则 resume 会发给死 sink
        self.assertEqual(pb._resume_at, 42.5)

    def test_idle_sink_release_reloads_and_seeks_on_resume(self):
        """久暂停后 player 丢 sink 省电;bridge 必须把它视为可恢复冷启动。"""
        player = SeekTrackingConn()
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index = 1
        pb._loaded = True
        pb.pos = 42.5
        run(
            pb.on_player_event(
                types.SimpleNamespace(ev="player", type="unloaded", data={"pos": 42.5})
            )
        )

        self.assertFalse(pb._loaded)
        self.assertFalse(pb.playing)
        self.assertEqual(pb._resume_at, 42.5)

        run(pb.resume())
        self.assertIn("load", player.calls)
        self.assertEqual(player.seeks, [42.5])

    def test_resume_reloads_and_seeks_back(self):
        player = SeekTrackingConn()
        pb = self._died_at(player)
        run(pb.resume())
        self.assertIn("load", player.calls)  # 重新加载,而不是裸发 resume
        self.assertEqual(player.seeks, [42.5])  # 跳回中断处
        self.assertEqual(pb.index, 1)  # 还是原来那首
        self.assertAlmostEqual(pb.pos, 42.5)

    def test_seek_failure_falls_back_to_start_not_error(self):
        """上游不支持 Range 时 seek 会失败:降级从头播,不能让「按播放键」变成报错。"""
        player = SeekTrackingConn(seek_ok=False)
        pb = self._died_at(player)
        run(pb.resume())
        self.assertIn("load", player.calls)
        self.assertTrue(pb.playing)  # 照样在播
        self.assertEqual(pb.last_error, "")  # 不算失败

    def test_new_song_clears_the_resume_point(self):
        """换歌后 _resume_at 必须清零,否则下一首会莫名跳到中间。"""
        player = SeekTrackingConn()
        pb = self._died_at(player)
        run(pb._play_index(2))
        self.assertEqual(pb._resume_at, 0.0)
        self.assertEqual(player.seeks, [])

    def test_non_fatal_error_leaves_playback_state_alone(self):
        """seek_failed 不杀 sink(audio.rs 里 try_seek 失败只发事件,照常出声)。
        若照样记中断处,之后任何 resume 都会白重载并往回跳 —— 真机实测踩过:
        seek_failed 后音频已播到 222s,resume 却跳回 189s。"""
        player = SeekTrackingConn()
        pb = self._died_at(player, pos=189.1, code="seek_failed")
        self.assertTrue(pb._loaded)  # 流没死,别动
        self.assertEqual(pb._resume_at, 0.0)
        self.assertTrue(pb.playing)

        run(pb.resume())
        self.assertNotIn("load", player.calls)  # 不该重载
        self.assertEqual(player.seeks, [])  # 更不该往回跳
        self.assertIn("resume", player.calls)

    def test_queue_clear_clears_the_resume_point(self):
        player = SeekTrackingConn()
        pb = self._died_at(player)
        run(pb.queue_clear())
        self.assertEqual(pb._resume_at, 0.0)


class GatedLoadConn(SeekTrackingConn):
    """load 挂起到 release,用来在加载途中插入操作。"""

    def __init__(self):
        super().__init__()
        self.load_started = asyncio.Event()
        self.release = asyncio.Event()

    async def request(self, cmd, args=None, *, is_current=None):
        if cmd == "load":
            self.load_started.set()
            await self.release.wait()
        return await super().request(cmd, args, is_current=is_current)


class FlakyUrlConn(FakeConn):
    """前 failures 次 song_url 失败(fetch_failed 不触发重试)。"""

    def __init__(self, failures=1):
        super().__init__()
        self.failures = failures

    async def request(self, cmd, args=None, *, is_current=None):
        if cmd == "song_url" and self.failures:
            self.failures -= 1
            self.calls.append(cmd)
            err = types.SimpleNamespace(code="fetch_failed", message="fetch_failed")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return await super().request(cmd, args, is_current=is_current)


class TestSeekWhileNotPlaying(unittest.TestCase):
    """暂停 / 冷态下拖进度。player 里没有音源(重启回灌未开播、久暂停释放 sink、断流、崩溃)时
    seek 会被静默忽略;此前 bridge 也不记,按播放键回到旧位置,拖的进度直接丢了。"""

    def _released_at(self, player, pos=42.5):
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index = 1
        pb._loaded = True
        pb.pos = pos
        run(
            pb.on_player_event(
                types.SimpleNamespace(ev="player", type="unloaded", data={"pos": pos})
            )
        )
        return pb

    def test_cold_seek_becomes_resume_point(self):
        player = SeekTrackingConn()
        pb = self._released_at(player)
        events = _capture_events(pb.seek(100.0))
        self.assertEqual(player.calls, [])  # player 里没有音源,发过去只会被忽略
        self.assertEqual((pb._resume_at, pb.snapshot()["pos"]), (100.0, 100.0))
        self.assertEqual(events, [{"ev": "player", "type": "paused", "data": {"pos": 100.0}}])

        run(pb.resume())
        self.assertIn("load", player.calls)
        self.assertEqual(player.seeks, [100.0])  # 从拖到的位置播,不是久暂停时的 42.5

    def test_seek_before_first_play_after_restore(self):
        player = SeekTrackingConn()
        pb = Playback(player, FakeConn())
        pb.restore({"items": [item("a"), item("b")], "index": 1})
        run(pb.seek(30.0))
        self.assertEqual(player.calls, [])  # 重启回灌后 player 里还没有音源
        run(pb.resume())
        self.assertEqual(player.seeks, [30.0])
        self.assertGreater(player.calls.index("seek"), player.calls.index("load"))

    def test_seek_during_cold_load_applies_once_loaded(self):
        player = GatedLoadConn()
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index, pb._resume_at = 1, 42.5

        async def scenario():
            resuming = asyncio.create_task(pb.resume())
            await player.load_started.wait()
            await pb.seek(100.0)
            player.release.set()
            await resuming

        run(scenario())
        self.assertEqual(player.seeks, [100.0])  # 以加载完成时的接续点为准
        self.assertEqual(pb.pos, 100.0)
        self.assertEqual(pb._resume_at, 0.0)  # 用过即清,别让之后的冷启动再跳一次

    def test_loaded_seek_goes_to_player_and_tracks_its_report(self):
        player = SeekTrackingConn()
        pb = Playback(player, FakeConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index, pb._loaded, pb.pos = 1, True, 42.5
        events = _capture_events(pb.seek(100.0))
        self.assertEqual(player.seeks, [100.0])
        self.assertEqual(events, [])  # 落点以 player 回报为准,bridge 不抢先改
        self.assertEqual(pb._resume_at, 0.0)  # 流还活着,不是重载接续点

        # audio.rs::seek 暂停中成功后回报 paused
        run(
            pb.on_player_event(
                types.SimpleNamespace(ev="player", type="paused", data={"pos": 100.0})
            )
        )
        self.assertEqual(pb.snapshot()["pos"], 100.0)

    def test_seek_without_current_track_is_ignored(self):
        player = SeekTrackingConn()
        pb = Playback(player, FakeConn())
        events = _capture_events(pb.seek(10.0))
        self.assertEqual((player.calls, events, pb._resume_at), ([], [], 0.0))

    def test_failed_cold_resume_keeps_resume_point(self):
        """取 URL 失败后再按播放键仍从中断处接上(此前 _play_index 一进来就把它清零)。"""
        player = SeekTrackingConn()
        pb = Playback(player, FlakyUrlConn())
        pb.queue = [item(c) for c in "abc"]
        pb.index, pb._resume_at = 1, 42.5
        run(pb.resume())
        self.assertNotIn("load", player.calls)
        self.assertEqual(pb._resume_at, 42.5)

        run(pb.resume())
        self.assertEqual(player.seeks, [42.5])
