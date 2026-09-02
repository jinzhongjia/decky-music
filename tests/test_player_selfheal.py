"""player 崩了要能自己回来,音量要跟持久化值对上 —— 两条真机踩到的。

1. player 单独崩掉(不是 bridge 挂)时,原先没有任何重启路径:provider 有
   `_ensure_provider` 在每条命令前兜,player 只在 `_main` spawn 一次。加上
   playback 的 `_loaded` 停在 True(它假设"bridge 与 player 同生共死"),之后每次
   resume 都只是朝一个不存在的进程发命令 —— 表现为"按播放键永远没反应",只能重启
   plugin_loader。
2. bridge 只在用户拖音量 / clear_data 时下发 volume,启动路径从不发,而 player 自己
   默认满音量。于是重启后 UI 滑块显示持久化值(如 0.4)、实际却在 100% 出声,
   MPRIS 的 Volume 属性也跟着偏。

运行:python -m unittest tests.test_player_selfheal
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
decky_stub = sys.modules["decky"]

import bridge as bridge_mod  # noqa: E402
import protocol  # noqa: E402
from bridge import Bridge, Conn  # noqa: E402


class _LiveProc:
    returncode = None

    def kill(self):
        self.returncode = -9

    terminate = kill


class _PlayerConn:
    """够 _sync_player_volume / _ensure_player 用的 player 连接替身。"""

    def __init__(self, connect=True):
        self.path = "/tmp/player.sock"
        self.connected = asyncio.Event()
        if connect:
            self.connected.set()
        self.sent = []
        self.on_missing = self.on_lost = None

    async def request(self, cmd, args=None):
        self.sent.append((cmd, args))
        return protocol.ChildResponse(1, True, {}, None)


def _bridge(volume=0.4, connect=True):
    b = Bridge()
    b.player = _PlayerConn(connect=connect)
    b.player_proc = None
    b.player_lock = asyncio.Lock()
    b.player_failed = False
    b.settings = {"volume": volume}
    return b


class TestVolumeSyncOnSpawn(unittest.TestCase):
    def test_persisted_volume_is_pushed_after_spawn(self):
        """回归:不同步的话 UI 显示 40%、player 却在 100% 出声。"""
        b = _bridge(volume=0.4)
        asyncio.run(b._sync_player_volume())
        self.assertEqual(b.player.sent, [("volume", {"val": 0.4})])

    def test_default_volume_is_also_pushed(self):
        """默认 0.8 也得发 —— player 自己的默认是 1.0,不发就还是差着。"""
        b = Bridge()
        b.player = _PlayerConn()
        b.player_failed = False
        b.settings = {}
        asyncio.run(b._sync_player_volume())
        self.assertEqual(b.player.sent, [("volume", {"val": 0.8})])

    def test_not_synced_when_spawn_failed(self):
        b = _bridge()
        b.player_failed = True
        asyncio.run(b._sync_player_volume())
        self.assertEqual(b.player.sent, [])

    def test_never_connecting_player_does_not_hang_startup(self):
        """player 连不进来是它自己的问题,不该把启动挂死在这儿。"""
        b = _bridge(connect=False)
        saved = bridge_mod.PLAYER_CONNECT_TIMEOUT
        bridge_mod.PLAYER_CONNECT_TIMEOUT = 0.05
        try:
            asyncio.run(asyncio.wait_for(b._sync_player_volume(), 2))
        finally:
            bridge_mod.PLAYER_CONNECT_TIMEOUT = saved
        self.assertEqual(b.player.sent, [])


class TestEnsurePlayer(unittest.TestCase):
    def test_alive_and_connected_is_idempotent(self):
        """并发命令会连着调,不能每次都重开一个。"""
        b = _bridge()
        b.player_proc = _LiveProc()
        spawned = []

        async def spy(*a, **k):
            spawned.append(a)
            return _LiveProc()

        saved, bridge_mod.spawn = bridge_mod.spawn, spy
        try:
            asyncio.run(b._ensure_player())
        finally:
            bridge_mod.spawn = saved
        self.assertEqual(spawned, [])

    def test_dead_player_is_respawned(self):
        b = _bridge()
        b.player_proc = None  # 崩了

        async def spy(*_a, **_k):
            b.player.connected.set()  # 真 player spawn 后会连入 UDS
            return _LiveProc()

        saved_spawn, bridge_mod.spawn = bridge_mod.spawn, spy
        saved_bin, bridge_mod.BIN = bridge_mod.BIN, lambda n: "/tmp/" + n
        try:
            asyncio.run(b._ensure_player())
        finally:
            bridge_mod.spawn, bridge_mod.BIN = saved_spawn, saved_bin
        self.assertIsNotNone(b.player_proc)
        # 重开之后音量必须重新同步:新进程又是默认满音量
        self.assertEqual(b.player.sent, [("volume", {"val": 0.4})])

    def test_respawn_does_not_deadlock_on_its_own_lock(self):
        """_sync_player_volume 走 player.request,而 request 的 on_missing 就是本方法。
        锁内同步 = 自己等自己(asyncio.Lock 不可重入),必须在锁外做。"""
        b = _bridge()
        b.player.on_missing = b._ensure_player  # 真实装配下的回环
        b.player_proc = None

        async def spy(*_a, **_k):
            b.player.connected.set()
            return _LiveProc()

        saved_spawn, bridge_mod.spawn = bridge_mod.spawn, spy
        saved_bin, bridge_mod.BIN = bridge_mod.BIN, lambda n: "/tmp/" + n
        try:
            asyncio.run(asyncio.wait_for(b._ensure_player(), 2))  # 死锁则超时
        finally:
            bridge_mod.spawn, bridge_mod.BIN = saved_spawn, saved_bin


class TestConnMissingHook(unittest.TestCase):
    def test_request_pulls_child_up_before_giving_up(self):
        """writer 为空时先给一次拉起机会,而不是直接返回 timeout。"""
        c = Conn("player")
        calls = []

        async def pull():
            calls.append(1)  # 拉起后仍连不上:request 照旧返回 timeout,不能卡住

        c.on_missing = pull
        r = asyncio.run(c.request("pause"))
        self.assertEqual(calls, [1])
        self.assertFalse(r.ok)
        self.assertEqual(r.error.code, "timeout")

    def test_no_hook_keeps_old_behaviour(self):
        """provider 不装 on_missing(它走 _ensure_provider),行为必须原样。"""
        c = Conn("provider")
        r = asyncio.run(c.request("search_hot"))
        self.assertFalse(r.ok)
        self.assertEqual(r.error.code, "timeout")

    def test_disconnect_notifies_on_lost(self):
        c = Conn("player")
        seen = []
        c.on_lost = lambda: seen.append(1)
        c.disconnect()
        self.assertEqual(seen, [1])


class TestPlaybackPlayerGone(unittest.TestCase):
    """player 猝死连 error 事件都发不出来,STREAM_DEATH_ERRORS 那条路走不到。"""

    def _pb(self):
        from playback import Playback

        pb = Playback(_PlayerConn(), None, "list_loop")
        return pb

    def test_records_resume_point_and_cools_loaded(self):
        pb = self._pb()
        pb._loaded = True
        pb.playing = True
        pb.pos = 87.5
        pb.player_gone()
        self.assertFalse(pb._loaded)  # 否则 resume 只会朝不存在的进程发命令
        self.assertFalse(pb.playing)
        self.assertEqual(pb._resume_at, 87.5)

    def test_not_loaded_keeps_resume_point_untouched(self):
        """没在播就没有中断处可记,别把上一次的 _resume_at 覆盖成 0。"""
        pb = self._pb()
        pb._loaded = False
        pb._resume_at = 42.0
        pb.player_gone()
        self.assertEqual(pb._resume_at, 42.0)


class TestUnloadDetachesHooks(unittest.TestCase):
    def test_unload_clears_selfheal_hooks(self):
        """主动下线不是崩溃:close() 引发的断连不该被当成猝死,更不该顺手再拉起来。"""
        b = _bridge()
        b.player.on_lost = lambda: None
        b.player.on_missing = lambda: None
        b.provider_proc = None
        closed = []

        class _C:
            async def close(self):
                closed.append(1)

        b.provider = _C()
        b.player.close = _C().close
        asyncio.run(b.unload())
        self.assertIsNone(b.player.on_lost)
        self.assertIsNone(b.player.on_missing)



class TestVolumePersistence(unittest.TestCase):
    def test_volume_is_applied_immediately_but_persisted_once(self):
        b = _bridge()
        saved = []
        original = bridge_mod.save_settings
        bridge_mod.save_settings = lambda data: saved.append(data.copy())

        async def check():
            await b.volume(0.65)
            self.assertEqual(b.player.sent, [("volume", {"val": 0.65})])
            self.assertEqual(saved, [])
            await b._flush_volume_persist()

        try:
            asyncio.run(check())
        finally:
            bridge_mod.save_settings = original
        self.assertEqual(saved, [{"volume": 0.65}])


class TestUnloadBackgroundTasks(unittest.TestCase):
    def test_unload_cancels_bridge_owned_tasks(self):
        b = _bridge()
        b.provider = type("Conn", (), {"close": staticmethod(_emit)})()
        b.player.close = _emit
        b.provider_proc = None
        cancelled = asyncio.Event()
        original = bridge_mod.save_settings
        bridge_mod.save_settings = lambda _data: None

        async def linger():
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        async def check():
            task = b._track_task(linger())
            await asyncio.sleep(0)
            await b.unload()
            self.assertTrue(task.cancelled())
            self.assertTrue(cancelled.is_set())

        try:
            asyncio.run(check())
        finally:
            bridge_mod.save_settings = original

if __name__ == "__main__":
    unittest.main()
