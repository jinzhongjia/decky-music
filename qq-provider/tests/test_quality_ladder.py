"""音质阶梯:选的是**上限**,下面的档必须全部保留作兜底。

命门在最后一条:如果选了无损就只试无损,那所有无版权 / 非会员的歌会直接放不出来 ——
这个功能就从"更好听"变成"一开就废一半曲库"。

只跑本模块:uv run python -m unittest tests.test_quality_ladder
"""

import asyncio
import unittest
from unittest import mock

import protocol
from main import handle
from qq import playback as playback_mod
from qq.playback import (
    DEFAULT_QUALITY,
    HIGH_QUALITY_CT,
    LADDER,
    QUALITIES,
    _ct_for,
    _ladder,
)


class TestQualityLadder(unittest.TestCase):
    def test_cap_excludes_higher_tiers(self):
        # 选标准就别偷偷给无损:上限之上的档一个都不问
        self.assertEqual([n for n, _, _ in _ladder("standard")], ["standard"])
        self.assertEqual([n for n, _, _ in _ladder("high")], ["high", "high", "standard"])

    def test_lossless_keeps_every_lower_tier_as_fallback(self):
        self.assertEqual(
            [n for n, _, _ in _ladder("lossless")],
            ["lossless", "lossless", "high", "high", "standard"],
        )

    def test_each_high_tier_covers_two_containers(self):
        """高档位各带两个前缀:主力 + OGG 兜底。批量单请求,多带零成本。"""
        for tier in ("lossless", "high"):
            prefixes = [p for n, p, _ in LADDER if n == tier]
            self.assertEqual(len(prefixes), 2, f"{tier} 应有两个前缀")
            self.assertTrue(any(p.startswith("O") for p in prefixes), f"{tier} 缺 OGG 兜底")

    def test_true_lossless_before_lossy_ogg(self):
        # 用户选"无损"就先给真无损(FLAC),拿不到再退 OGG 640
        self.assertEqual([p for n, p, _ in LADDER if n == "lossless"][0], "F000")

    def test_bad_value_falls_back_to_default(self):
        for bad in ("", "hires", "MP3_320", None, "标准"):
            self.assertEqual(_ladder(bad), _ladder(DEFAULT_QUALITY), f"bad={bad!r}")

    def test_every_tier_ends_at_the_cheapest(self):
        # 反证:任何一档的阶梯末端都必须是 standard,否则该档会有播不了的歌
        for q in QUALITIES:
            self.assertEqual(_ladder(q)[-1][0], "standard", f"quality={q}")

    def test_single_round_trip_covers_every_tier(self):
        """一次请求问全部档位:filename 列表长度 = 阶梯长度,不再逐档往返。"""
        self.assertEqual(len(_ladder("lossless")), 5)
        self.assertEqual(len(_ladder("standard")), 1)

    def test_only_decodable_containers(self):
        # player 的 rodio 只带 flac/mp3/ogg/m4a/wav;加密档(.mflac/.mgg)与 NAC 解不了
        for _, prefix, ext in LADDER:
            self.assertIn(ext, ("flac", "mp3", "ogg", "m4a"))
            self.assertNotIn("M0", prefix[2:], f"{prefix} 看着像加密档前缀")


class TestCtValue(unittest.TestCase):
    """ct 不只是反风控开关,它决定服务端愿意下发哪些音质。

    真机扫过 ct=2..30(同账号同曲):ct=2/6/26 只给 128k —— FLAC 与 320k 一律空,
    **而且不报错**;ct=11(库默认)连 128k 都不给。我们原来硬编码 ct=6,于是一个
    SVIP 年费账号也只能听 128k,静默降级到查不出来。这几个值必须永远排除。

    坑的来源:quaverq 那份 safe-ct 列表是用 MP3_128 探的(它自己脚本里写着"用最低档
    探测,信号最干净"),所以列表里混着这些"低档能过、高档被拒"的值。
    """

    BAD_CT = (2, 6, 26, 11)  # 前三个只给 128k;11 是库默认,什么都不给

    def test_bad_ct_values_are_excluded(self):
        for bad in self.BAD_CT:
            self.assertNotIn(bad, HIGH_QUALITY_CT, f"ct={bad} 拿不到高音质,不该在列表里")

    def test_derived_ct_is_always_from_the_good_list(self):
        for guid in ("", "a", "deadbeef" * 4, "0" * 32, "z" * 64):
            self.assertIn(_ct_for(guid), HIGH_QUALITY_CT, f"guid={guid!r}")

    def test_same_device_same_ct(self):
        # 同一台设备来回换 ct 本身可疑;guid 已持久化,派生值必须稳定
        g = "3f8a1c9e7b2d4a6f8c0e1d3b5a7f9c2e"
        self.assertEqual(_ct_for(g), _ct_for(g))

    def test_different_devices_spread_out(self):
        # 所有安装共用一个 ct = 同一指纹从大量 IP 冒出来,正是风控特征
        got = {_ct_for(f"{i:032x}") for i in range(200)}
        self.assertGreater(len(got), 10, f"分散度太低: {sorted(got)}")


class TestSongUrlArgs(unittest.TestCase):
    """回归:quality 缺失 / 空串不能让 song_url 变成 invalid_request。

    第一版用了 qq.library._as_str,它对缺失或空值抛 ValueError,而 handle() 把 ValueError
    映射成 invalid_request —— 结果就是「没带 quality 的点歌请求直接放不出歌」。
    """

    def _call(self, args):
        async def fake_song_url(_q, _mid, _media_mid="", quality=DEFAULT_QUALITY):
            return "http://example/x.mp3", quality

        with mock.patch.object(playback_mod, "song_url", fake_song_url):
            req = protocol.Request(1, "song_url", args)
            return asyncio.run(handle(object(), req, lambda *_a, **_k: None, lambda *_a: None))

    def test_missing_quality_uses_default(self):
        r = self._call({"id": "abc"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["data"]["quality"], DEFAULT_QUALITY)

    def test_empty_quality_uses_default(self):
        r = self._call({"id": "abc", "quality": ""})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["data"]["quality"], DEFAULT_QUALITY)

    def test_explicit_quality_is_honoured(self):
        r = self._call({"id": "abc", "quality": "lossless"})
        self.assertEqual(r["data"]["quality"], "lossless")


if __name__ == "__main__":
    unittest.main()
