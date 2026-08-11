"""子进程 stderr 的噪声分级(issue #46)。

真机 v1.0.0 上 player 每次启动都会打出几行 ALSA/PipeWire 设备探测输出,紧接着
"audio: default audio device opened" 就成功了。它们不是"非预期输出",却每次占据 release
日志顶部的 WARNING,削弱 stderr「出现即可疑」的信号价值。

这里钉住两件事:已知噪声降到 debug;**没列进表的一律仍是 warn**(过滤必须窄,不能把
真实的设备级报错一起吞掉)。

decky 是 Decky 运行时注入的模块,测试里打桩。
运行:python -m unittest tests.test_stderr_filter
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
sys.modules.setdefault("decky", decky_stub)

import log as log_mod  # noqa: E402

# 真机 v1.0.0 日志里逐字抄下来的四行(2026-08-11 10.43.41.log)
REAL_NOISE = [
    "cannot connect player.P.1467.2:out_000 to system:playback_1",
    "cannot connect player.P.1467.4:out_000 to system:playback_1",
    "cannot connect player.P.1467.5:out_000 to system:playback_1",
    "ALSA lib pcm_oss.c:404:(_snd_pcm_oss_open) Cannot open device /dev/dsp",
]


class TestStderrLevel(unittest.TestCase):
    def test_real_device_noise_is_demoted(self):
        for line in REAL_NOISE:
            self.assertEqual(log_mod.stderr_level(line), "debug", line)

    def test_other_known_probe_forms_are_demoted(self):
        for line in [
            "ALSA lib pcm_dmix.c:1032:(snd_pcm_dmix_open) unable to open slave",
            "ALSA lib pcm.c:2722:(snd_pcm_open_noupdate) Unknown PCM cards.pcm.rear",
            "ALSA lib confmisc.c:1369:(snd_func_refer) Unknown parameter default",
        ]:
            self.assertEqual(log_mod.stderr_level(line), "debug", line)

    def test_real_failures_stay_warn(self):
        """过滤写窄的意义就在这里:真出事的行必须还能冒出来。"""
        for line in [
            "thread 'main' panicked at src/audio.rs:42:9:",
            "ALSA lib pcm_hw.c:1829:(snd_pcm_hw_open) open '/dev/snd/pcmC0D0p' failed: No such device",
            "ALSA lib: could not open any audio device",
            "Traceback (most recent call last):",
            "cannot connect to PipeWire",  # 形似但不是端口探测那条
            "cannot connect player.P.1467.2:out_000 to system:capture_1",  # 采集口,不在表内
            "audio: default audio device opened",
        ]:
            self.assertEqual(log_mod.stderr_level(line), "warn", line)


class _FakeStream:
    """按行喂 bytes 的假 stderr;读完返回 b"" 表示 EOF。"""

    def __init__(self, lines):
        self._lines = list(lines)

    async def readline(self):
        return self._lines.pop(0) if self._lines else b""


class TestPumpStderr(unittest.TestCase):
    def setUp(self):
        self.records = []
        self._saved = log_mod.log
        log_mod.log = lambda source, origin, level, msg: self.records.append((origin, level, msg))

    def tearDown(self):
        log_mod.log = self._saved

    def test_mixed_stream_splits_by_level(self):
        stream = _FakeStream(
            [
                b"cannot connect player.P.1.2:out_000 to system:playback_1\n",
                b"thread 'main' panicked at src/lib.rs:1:1:\n",
                b"\n",  # 空行不该产生记录
                b"ALSA lib pcm_oss.c:404:(_snd_pcm_oss_open) Cannot open device /dev/dsp\n",
            ]
        )
        asyncio.run(log_mod.pump_stderr("player", stream))

        self.assertEqual([r[1] for r in self.records], ["debug", "warn", "debug"])
        self.assertTrue(all(r[0] == "stderr" for r in self.records))
        # panic 必须原样保留,不被改写
        self.assertIn("panicked", self.records[1][2])

    def test_no_stream_is_a_noop(self):
        asyncio.run(log_mod.pump_stderr("player", None))
        self.assertEqual(self.records, [])


if __name__ == "__main__":
    unittest.main()
