"""RPC 契约三端一致:main.CALLABLES ↔ Bridge 方法 ↔ src/api.ts 的 callable() 声明。

替代过去 main.py 里 48 个同名转发方法的作用 —— 那些方法只是把名字抄一遍,抄错也要等
运行时才炸;这里在测试期机械校验,且顺带覆盖 __getattr__ 的白名单行为。
"""

import inspect
import logging
import os
import re
import sys
import types
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "py_modules"))
sys.path.insert(0, ROOT)

# ---- 打桩 decky(必须在 import bridge 前) ----
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

import main as plugin_main  # noqa: E402
from bridge import Bridge  # noqa: E402


def api_ts_callables() -> set[str]:
    with open(os.path.join(ROOT, "src", "api.ts"), encoding="utf-8") as f:
        return set(re.findall(r'callable<[^>]*>\(\s*"([a-z_]+)"', f.read(), re.S))


class TestCallableContract(unittest.TestCase):
    def test_every_callable_exists_on_bridge(self):
        missing = sorted(n for n in plugin_main.CALLABLES if not callable(getattr(Bridge, n, None)))
        self.assertEqual(missing, [], "CALLABLES 里的名字在 Bridge 上不存在")

    def test_frontend_and_backend_declare_the_same_names(self):
        self.assertEqual(sorted(api_ts_callables()), sorted(plugin_main.CALLABLES))

    def test_getattr_forwards_whitelisted_names_only(self):
        plugin = plugin_main.Plugin()
        # _main 跑之前访问 bridge 必须直接抛,不能经 self.bridge 自递归成 RecursionError
        with self.assertRaises(AttributeError):
            getattr(plugin, "bridge")

        plugin.bridge = Bridge()
        # Decky loader 的调用形状:getattr(instance, name)(*args)
        self.assertEqual(plugin.get_queue.__self__, plugin.bridge)
        # 白名单外一律 AttributeError —— 含 Bridge 上真实存在但不该暴露成 RPC 的方法,
        # 以及 loader 用 hasattr 探测的可选钩子
        for name in ("start", "unload", "_ensure_provider", "_migration", "_uninstall"):
            with self.assertRaises(AttributeError):
                getattr(plugin, name)
        self.assertFalse(hasattr(plugin, "_migration"))

    def test_main_and_unload_stay_real_methods(self):
        # loader 用 hasattr 探测这两个,且要在 bridge 存在前就能拿到
        self.assertTrue(inspect.iscoroutinefunction(plugin_main.Plugin._main))
        self.assertTrue(inspect.iscoroutinefunction(plugin_main.Plugin._unload))


if __name__ == "__main__":
    unittest.main()
