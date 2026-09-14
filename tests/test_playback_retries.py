"""Playback recovery and retry regressions."""

import types
import unittest
from tests.playback_support import FakeConn, item, run, _capture_events
from playback import Playback


class FlakyAuthConn:
    """song_url 先报 no_playable,凭证刷新后放行(模拟 musickey 会话中途过期)。"""

    def __init__(self):
        self.calls = []
        self.refreshed = False

    async def request(self, cmd, args=None, *, is_current=None):
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

    async def request(self, cmd, args=None, *, is_current=None):
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

    async def request(self, cmd, args=None, *, is_current=None):
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

    async def request(self, cmd, args=None, *, is_current=None):
        self.calls.append(cmd)
        if cmd == "load":
            err = types.SimpleNamespace(code="fetch_failed", message="fetch_failed")
            return types.SimpleNamespace(ok=False, data={}, error=err)
        return types.SimpleNamespace(ok=True, data={}, error=None)


class UpstreamTimeoutConn:
    """provider 的 song_url 前 fail_times 次报 upstream_timeout,之后成功。
    记录每次被请求的歌曲 id —— 判「重试同一首」还是「顺延下一首」全靠它。"""

    def __init__(self, fail_times=99):
        self.calls = []
        self.asked = []
        self.fail_times = fail_times

    async def request(self, cmd, args=None, *, is_current=None):
        self.calls.append(cmd)
        if cmd == "song_url":
            self.asked.append((args or {}).get("id"))
            if len(self.asked) <= self.fail_times:
                err = types.SimpleNamespace(code="upstream_timeout", message="upstream_timeout")
                return types.SimpleNamespace(ok=False, data={}, error=err)
            return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)
        return types.SimpleNamespace(ok=True, data={}, error=None)


class TestUpstreamTimeoutRetriesSameSong(unittest.TestCase):
    """上游瞬时超时必须原地重试同一首,不能顺延。

    回归 2026-07-25/26 两次:先是被当成通道级 timeout 立即硬熔断(电台一首都不跳就停),
    改软熔断后又变成静默跳过下一首 —— 用户视角是「歌无故消失」,比报错更费解。
    正解是重试同一首:抖动就照常播出来,真故障就明确报错。
    """

    def setUp(self):
        import playback as playback_mod

        self._old = playback_mod.UPSTREAM_RETRY_BACKOFF
        playback_mod.UPSTREAM_RETRY_BACKOFF = 0  # 测试不真睡
        self.addCleanup(setattr, playback_mod, "UPSTREAM_RETRY_BACKOFF", self._old)

    def test_transient_timeout_plays_the_intended_song(self):
        """只抖一次:重试后该放的还是原来那首,不跳过。"""
        provider = UpstreamTimeoutConn(fail_times=1)
        pb = Playback(FakeConn(), provider)
        pb.queue = [item(c) for c in "abcde"]
        pb.index = 0
        run(pb._on_ended())
        self.assertEqual(provider.asked, ["b", "b"])  # 同一首问了两次
        self.assertEqual(pb.index, 1)  # 落在 b,没被跳到 c
        self.assertTrue(pb.playing)

    def test_persistent_timeout_never_skips_to_another_song(self):
        """一直超时:重试也失败 → 熔断报错,绝不顺延到别的歌。"""
        provider = UpstreamTimeoutConn()
        pb = Playback(FakeConn(), provider)
        pb.queue = [item(c) for c in "abcde"]
        pb.index = 0
        run(pb._on_ended())
        self.assertEqual(set(provider.asked), {"b"})  # 只碰过 b 这一首
        self.assertEqual(len(provider.asked), 2)  # 首发 + 一次重试,不再多试
        self.assertFalse(pb.playing)
        self.assertEqual(pb.last_error, "upstream_timeout")

    def test_radio_advance_retries_then_reports(self):
        provider = UpstreamTimeoutConn()
        pb = Playback(FakeConn(), provider)
        pb.mode = "radio"
        pb.queue = [item(c) for c in "abcde"]
        pb.index = 0
        run(pb._radio_next())
        self.assertEqual(set(provider.asked), {"b"})
        self.assertEqual(len(provider.asked), 2)


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
