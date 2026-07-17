"""player 启动兜底单测:缺二进制(remote_binary 下载失败)时,_spawn_player
不裸炸 _main,而是给 UI 报 player_start_failed;spawn 成功则不发错误事件。

decky 是 Decky 运行时注入的模块,测试里打桩。运行:python -m unittest tests/test_player_spawn.py
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
# discover 跑全套时别的用例可能已装桩:补丁必须打在真正被 bridge 引用的那个模块上
decky_stub = sys.modules["decky"]

import bridge as bridge_mod  # noqa: E402
from bridge import Bridge  # noqa: E402


class _FakePlayer:
    path = "/tmp/player.sock"


class TestPlayerSpawn(unittest.TestCase):
    def setUp(self):
        self.b = Bridge()
        self.b.player = _FakePlayer()
        self.emitted = []

        async def capture(ev, payload):
            self.emitted.append((ev, payload))

        self._saved_emit = decky_stub.emit
        self._saved_spawn = bridge_mod.spawn
        decky_stub.emit = capture

    def tearDown(self):
        decky_stub.emit = self._saved_emit
        bridge_mod.spawn = self._saved_spawn

    def test_missing_binary_emits_error_no_raise(self):
        async def boom(*_a, **_k):
            raise FileNotFoundError("bin/player")  # 缺二进制的真实异常

        bridge_mod.spawn = boom
        asyncio.run(self.b._spawn_player())  # 关键:不应向上抛,否则 _main 整个挂掉
        self.assertEqual(len(self.emitted), 1)
        ev, payload = self.emitted[0]
        self.assertEqual(ev, "player")
        self.assertEqual(payload["type"], "error")
        self.assertEqual(payload["data"]["code"], "player_start_failed")
        self.assertTrue(self.b.player_failed)  # 回灌兜底态:get_playback 据此让 UI 补显 banner(#38)

    def test_spawn_ok_no_error_event(self):
        async def ok(*_a, **_k):
            return object()

        bridge_mod.spawn = ok
        asyncio.run(self.b._spawn_player())
        self.assertEqual(self.emitted, [])
        self.assertFalse(self.b.player_failed)


class _FakeProviderConn:
    def __init__(self):
        self.connected = asyncio.Event()
        self.path = "/tmp/provider.sock"


class TestProviderSpawn(unittest.TestCase):
    """provider 缺二进制:_ensure_provider 兜住失败、记 provider_error,get_provider 回灌给 UI(#38 同款回灌)。"""

    def setUp(self):
        self.b = Bridge()
        self.b.provider = _FakeProviderConn()
        self.b.provider_proc = None
        self.b.provider_which = None
        self.b.provider_lock = asyncio.Lock()
        self.b.provider_error = None
        self.b.settings = {"provider": "ncm", "accounts": {}}
        self._saved_emit = decky_stub.emit
        self._saved_spawn = bridge_mod.spawn
        self._saved_bin = bridge_mod.BIN
        decky_stub.emit = _emit  # 丢弃 emit(测回灌,不测 emit)

    def tearDown(self):
        decky_stub.emit = self._saved_emit
        bridge_mod.spawn = self._saved_spawn
        bridge_mod.BIN = self._saved_bin

    def test_spawn_fail_sets_error_and_get_provider_relays(self):
        async def boom(*_a, **_k):
            raise FileNotFoundError("bin/ncm-provider")

        bridge_mod.spawn = boom
        bridge_mod.BIN = lambda name: "/nonexistent/" + name
        asyncio.run(self.b._ensure_provider("ncm"))
        self.assertEqual(self.b.provider_error, "provider_start_failed")
        st = asyncio.run(self.b.get_provider())  # 回灌:get_provider 内部重试仍失败,带回 error
        self.assertEqual(st["error"], "provider_start_failed")


if __name__ == "__main__":
    unittest.main()
