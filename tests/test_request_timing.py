"""请求耗时日志单测:Conn.request 成功路径必须记下耗时,超阈值升 warn。

存在的理由是可诊断性 —— release 只落 INFO 以上,用户报「插件变慢」时若没有这条 warn,
日志里一点线索都没有(见 issue #44 的排查过程)。所以「慢请求要出现在 warn 里」是契约,
不是调试残留,得有测试钉住。

decky 是 Decky 运行时注入的模块,测试里打桩。运行:python -m unittest tests.test_request_timing
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

import bridge as bridge_mod  # noqa: E402
import protocol  # noqa: E402


class _FakeWriter:
    def __init__(self):
        self.lines = []

    def write(self, data):
        self.lines.append(data)

    async def drain(self):
        pass


class TestRequestTiming(unittest.TestCase):
    def setUp(self):
        self.conn = bridge_mod.Conn("provider")
        self.conn.writer = _FakeWriter()
        self.logs = []
        self._saved_log = bridge_mod.log
        self._saved_slow = bridge_mod.SLOW_REQUEST_S
        bridge_mod.log = lambda src, origin, level, msg: self.logs.append((level, msg))

    def tearDown(self):
        bridge_mod.log = self._saved_log
        bridge_mod.SLOW_REQUEST_S = self._saved_slow

    def _round_trip(self):
        """跑一次 request,并在它挂上 pending 后立刻替读循环把响应塞回去。"""

        async def run():
            task = asyncio.create_task(self.conn.request("song_url", {"id": "x"}))
            while not self.conn.pending:  # 等 request 把 future 登记进在途表
                await asyncio.sleep(0)
            rid, fut = next(iter(self.conn.pending.items()))
            fut.set_result(protocol.ChildResponse(rid, True, {}, None))
            return await task

        return asyncio.run(run())

    def test_fast_request_logs_debug(self):
        resp = self._round_trip()
        self.assertTrue(resp.ok)
        levels = [lv for lv, _ in self.logs]
        self.assertIn("debug", levels)
        self.assertNotIn("warn", levels)
        self.assertIn("song_url", self.logs[0][1])

    def test_slow_request_logs_warn(self):
        bridge_mod.SLOW_REQUEST_S = 0.0  # 任何耗时都算慢,免得测试真去 sleep 两秒
        self._round_trip()
        warns = [msg for lv, msg in self.logs if lv == "warn"]
        self.assertEqual(len(warns), 1)
        self.assertIn("slow provider request", warns[0])
        self.assertIn("song_url", warns[0])

    def test_timeout_does_not_log_timing(self):
        # 超时已有自己的 error 日志,别再叠一条误导性的耗时行
        saved = bridge_mod.REQUEST_TIMEOUT
        bridge_mod.REQUEST_TIMEOUT = 0.01
        try:
            resp = asyncio.run(self.conn.request("song_url"))
        finally:
            bridge_mod.REQUEST_TIMEOUT = saved
        self.assertFalse(resp.ok)
        self.assertEqual(resp.error.code, "timeout")
        self.assertNotIn("debug", [lv for lv, _ in self.logs])


if __name__ == "__main__":
    unittest.main()
