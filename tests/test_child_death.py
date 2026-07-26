"""子进程死掉之后 bridge 必须还能活:两条真机复现过的路。

1. provider 崩了/被杀 → 再 set_provider 时 terminate() 抛 ProcessLookupError,
   异常从 set_provider 冒出去,之后永久切不动,只能重启 Steam。
2. provider 卡死不响应(issue #44 的 100% CPU 自旋)→ 通道级 timeout。它不会自愈,
   必须判死杀掉,否则之后每个操作都先赔 30s。

decky 是 Decky 运行时注入的模块,测试里打桩。
运行:python -m unittest tests.test_child_death
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
from bridge import Bridge, Conn, stop_child  # noqa: E402


class _DeadProc:
    """已经退出的子进程:terminate/kill 抛 ProcessLookupError,同 asyncio 的行为。"""

    returncode = -9

    def terminate(self):
        raise ProcessLookupError()

    kill = terminate


class _LiveProc:
    returncode = None

    def __init__(self):
        self.killed = self.termed = False

    def kill(self):
        self.killed = True
        self.returncode = -9

    def terminate(self):
        self.termed = True


class TestStopChild(unittest.TestCase):
    def test_already_exited_does_not_raise(self):
        stop_child(_DeadProc())  # 不抛就是通过 —— 这正是"永久切不动"的根源
        stop_child(None)

    def test_hard_uses_kill(self):
        p = _LiveProc()
        stop_child(p, hard=True)
        self.assertTrue(p.killed)
        self.assertFalse(p.termed)


class _FakeWriter:
    def write(self, _d):
        pass

    async def drain(self):
        pass


class TestConnDeath(unittest.TestCase):
    def setUp(self):
        self.conn = Conn("provider")
        self.conn.writer = _FakeWriter()
        self._saved_log = bridge_mod.log
        bridge_mod.log = lambda *_a, **_k: None

    def tearDown(self):
        bridge_mod.log = self._saved_log

    def test_disconnect_fails_inflight_requests_fast(self):
        """在途请求要立刻失败,而不是干等满 30s —— 对面进程都没了。"""

        async def run():
            task = asyncio.create_task(self.conn.request("liked_ids"))
            while not self.conn.pending:
                await asyncio.sleep(0)
            self.conn.disconnect()  # 子进程死了
            return await asyncio.wait_for(task, 1)  # 1s 内必须有结果

        resp = asyncio.run(run())
        self.assertFalse(resp.ok)
        self.assertEqual(resp.error.code, "timeout")

    def test_request_after_death_short_circuits(self):
        self.conn.disconnect()
        resp = asyncio.run(self.conn.request("liked_ids"))
        self.assertFalse(resp.ok)
        self.assertEqual(resp.error.code, "timeout")

    def test_timeout_declares_child_dead(self):
        called = []
        self.conn.on_dead = lambda: called.append(1)
        saved = bridge_mod.REQUEST_TIMEOUT
        bridge_mod.REQUEST_TIMEOUT = 0.01
        try:
            resp = asyncio.run(self.conn.request("liked_ids"))
        finally:
            bridge_mod.REQUEST_TIMEOUT = saved
        self.assertFalse(resp.ok)
        self.assertEqual(called, [1])  # 判死回调必须被调到,否则不会重开进程


class TestProviderRespawn(unittest.TestCase):
    def setUp(self):
        self.b = Bridge()
        self._saved_log = bridge_mod.log
        bridge_mod.log = lambda *_a, **_k: None

    def tearDown(self):
        bridge_mod.log = self._saved_log

    def test_unresponsive_kills_process(self):
        p = _LiveProc()
        self.b.provider_proc = p
        self.b._provider_unresponsive()
        self.assertTrue(p.killed)
        self.assertIsNone(self.b.provider_proc)  # 置空 → _ensure_provider 会重开

    def test_repeated_calls_are_safe(self):
        """并发命令一起超时会连着调好几次,不能第二次就炸。"""
        self.b.provider_proc = _LiveProc()
        for _ in range(5):
            self.b._provider_unresponsive()
        self.assertIsNone(self.b.provider_proc)

    def test_dead_process_is_ignored(self):
        self.b.provider_proc = _DeadProc()
        self.b._provider_unresponsive()  # 抛 ProcessLookupError 就挂


if __name__ == "__main__":
    unittest.main()
