"""provider 进程没了之后,浏览类命令要能就地把它拉起来再重试一次。

真机复现:kill 掉 provider 后,search_songs 之类每次都立刻返回 timeout —— 因为
Conn.request 在 writer 为 None 时短路,而 _list_cmd 自己不经 _ensure_provider。
用户要退出去重开 QAM / 页面(那时才有 get_provider)才能恢复,现象像"插件坏了"。

这里钉住三件事:通道断了要重开并重试;上游错误不许触发重开(免得无版权的歌把
provider 反复重启);没选 provider 时不许重开。

decky 是 Decky 运行时注入的模块,测试里打桩。
运行:python -m unittest tests.test_provider_respawn_on_browse
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
decky_stub.DECKY_PLUGIN_LOG_DIR = "/tmp"
decky_stub.logger = logging.getLogger("test-decky")


async def _emit(*_a, **_k):
    pass


decky_stub.emit = _emit
sys.modules.setdefault("decky", decky_stub)

import bridge as bridge_mod  # noqa: E402
import protocol  # noqa: E402
from bridge import Bridge  # noqa: E402


def _ok(data):
    return protocol.ChildResponse(1, True, data, None)


def _err(code):
    return protocol.ChildResponse(1, False, {}, protocol.ErrorBody(code, code))


class _FakeConn:
    """按脚本依次返回响应;writer 为 None 表示通道已断(同 Conn.request 的短路条件)。"""

    def __init__(self, responses, writer=None):
        self.responses = list(responses)
        self.writer = writer
        self.calls = []

    async def request(self, cmd, args=None):
        self.calls.append((cmd, args))
        return self.responses.pop(0)


class TestRespawnOnBrowse(unittest.TestCase):
    def setUp(self):
        self.b = Bridge()
        self.b.settings = {"version": 1, "provider": "qq"}  # start() 才建,测试里直接给
        self.ensured = []

        async def fake_ensure(which):
            self.ensured.append(which)
            self.b.provider.writer = object()  # 重开成功 → 通道恢复

        self.b._ensure_provider = fake_ensure
        self._saved_log = bridge_mod.log
        bridge_mod.log = lambda *_a, **_k: None

    def tearDown(self):
        bridge_mod.log = self._saved_log

    def test_dead_channel_respawns_and_retries(self):
        self.b.provider = _FakeConn([_err("timeout"), _ok({"songs": [1, 2, 3]})], writer=None)
        out = asyncio.run(self.b._list_cmd("search_songs", "songs"))
        self.assertEqual(self.ensured, ["qq"], "通道断了必须重开 provider")
        self.assertEqual(out, {"ok": True, "songs": [1, 2, 3]})
        self.assertEqual(len(self.b.provider.calls), 2, "应当重试一次")

    def test_upstream_error_does_not_respawn(self):
        """通道还在,只是上游报错 —— 不该因此重启进程。"""
        self.b.provider = _FakeConn([_err("upstream_timeout")], writer=object())
        out = asyncio.run(self.b._list_cmd("search_songs", "songs"))
        self.assertEqual(self.ensured, [])
        self.assertEqual(out, {"ok": False, "songs": [], "error": "upstream_timeout"})

    def test_no_provider_selected_does_not_respawn(self):
        self.b.settings["provider"] = None
        self.b.provider = _FakeConn([_err("timeout")], writer=None)
        out = asyncio.run(self.b._list_cmd("search_songs", "songs"))
        self.assertEqual(self.ensured, [])
        self.assertFalse(out["ok"])

    def test_respawn_failing_again_reports_error_once(self):
        """重开后仍失败:正常报错,不再无限重试。"""

        async def ensure_but_still_dead(which):
            self.ensured.append(which)

        self.b._ensure_provider = ensure_but_still_dead
        self.b.provider = _FakeConn([_err("timeout"), _err("timeout")], writer=None)
        out = asyncio.run(self.b._list_cmd("search_songs", "songs"))
        self.assertEqual(self.ensured, ["qq"])
        self.assertEqual(len(self.b.provider.calls), 2)
        self.assertEqual(out, {"ok": False, "songs": [], "error": "timeout"})

    def test_success_path_untouched(self):
        self.b.provider = _FakeConn([_ok({"songs": [7]})], writer=object())
        out = asyncio.run(self.b._list_cmd("search_songs", "songs"))
        self.assertEqual(self.ensured, [])
        self.assertEqual(out, {"ok": True, "songs": [7]})


if __name__ == "__main__":
    unittest.main()
