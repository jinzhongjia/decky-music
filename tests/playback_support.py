"""playback 队列编辑单测(P4):插入/移除的索引账目、清空空态、持久化回调。

decky 是 Decky 运行时注入的模块,测试里打桩;player/provider 用假 Conn(鸭子类型)。
运行:python -m unittest tests/test_playback.py
"""

import asyncio
import logging
import os
import sys
import types

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

import ipc


class FakeConn(ipc.Conn):
    """假 Conn:song_url / load / stop 全部成功。"""

    def __init__(self):
        super().__init__("provider")
        self.calls = []

    async def request(self, cmd, args=None, *, is_current=None):
        self.calls.append(cmd)
        return types.SimpleNamespace(ok=True, data={"url": "http://x"}, error=None)


def item(i: str) -> dict:
    return {"id": i, "media_mid": f"m{i}", "name": i, "singer": "", "cover": "", "duration": 1}


def run(coro):
    return asyncio.run(coro)


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
