"""设备身份必须跨进程稳定(issue #44 根因调查)。

qqmusic_api 在 device_path=None 时只在内存里维护设备,而 imei / android_id / boot_id
全是随机生成 —— provider 每次重启在 QQ 看来都是一台新安卓机,同账号同 IP 冒出大量新设备
是典型风控特征。这里锁住"给了 state_dir 就必须持久化且稳定"这条契约。
"""

import json
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qq import DEVICE_FILE, QQ  # noqa: E402


async def _boot(state_dir):
    """模拟一次 provider 进程启动:构造 + ensure_device + 取 guid。"""
    return await _boot_with(QQ(state_dir=state_dir))


async def _boot_with(qq):
    await qq.ensure_device()
    return await qq.get_guid()


def run(coro):
    import asyncio

    return asyncio.run(coro)


class TestDeviceIdentityPersistence(unittest.TestCase):
    def test_same_state_dir_yields_the_same_device_across_processes(self):
        """两次构造 QQ(模拟进程重启)必须拿到同一台设备。"""
        with tempfile.TemporaryDirectory() as d:
            first = run(_boot(d))
            ident = json.loads(open(os.path.join(d, DEVICE_FILE), encoding="utf-8").read())
            second = run(_boot(d))
            self.assertEqual(first, second, "重启后 guid 变了 = 在 QQ 看来换了台设备")
            again = json.loads(open(os.path.join(d, DEVICE_FILE), encoding="utf-8").read())
            for key in ("imei", "android_id", "boot_id", "fingerprint", "open_udid"):
                self.assertEqual(ident[key], again[key], f"{key} 不该在重启后变化")

    def test_device_file_is_private(self):
        """文件里是伪造的 IMEI 等标识,按 settings.json 同口径 0600。"""
        with tempfile.TemporaryDirectory() as d:
            old = os.umask(0o000)  # 即使 umask 全开也必须是 0600
            try:
                run(_boot(d))
            finally:
                os.umask(old)
            mode = stat.S_IMODE(os.stat(os.path.join(d, DEVICE_FILE)).st_mode)
            self.assertEqual(mode, 0o600)

    def test_reset_client_keeps_the_same_device(self):
        """超时重建 client 不能顺手换设备 —— 那正好制造风控特征。"""
        with tempfile.TemporaryDirectory() as d:
            qq = QQ(state_dir=d)
            before = run(_boot_with(qq))
            qq.reset_client()
            self.assertEqual(run(qq.get_guid()), before)

    def test_no_state_dir_falls_back_to_memory(self):
        """没注入 state_dir(单测直接起进程)时不该炸,退回库的内存态。"""
        qq = QQ(state_dir=None)
        self.assertIsNone(qq._device_path)
        self.assertTrue(run(qq.get_guid()))


if __name__ == "__main__":
    unittest.main()
