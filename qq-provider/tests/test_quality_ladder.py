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
from qq.playback import DEFAULT_QUALITY, LADDER, QUALITIES, _ladder


class TestQualityLadder(unittest.TestCase):
    def test_cap_excludes_higher_tiers(self):
        # 选标准就别偷偷给无损:上限之上的档一个都不试
        self.assertEqual([n for n, _, _ in _ladder("standard")], ["standard"])
        self.assertEqual([n for n, _, _ in _ladder("high")], ["high", "standard"])

    def test_lossless_keeps_every_lower_tier_as_fallback(self):
        self.assertEqual([n for n, _, _ in _ladder("lossless")], ["lossless", "high", "standard"])

    def test_bad_value_falls_back_to_default(self):
        for bad in ("", "hires", "MP3_320", None, "标准"):
            self.assertEqual(_ladder(bad), _ladder(DEFAULT_QUALITY), f"bad={bad!r}")

    def test_every_tier_ends_at_the_cheapest(self):
        # 反证:任何一档的阶梯末端都必须是 standard,否则该档会有播不了的歌
        for q in QUALITIES:
            self.assertEqual(_ladder(q)[-1][0], "standard", f"quality={q}")

    def test_only_decodable_containers(self):
        # player 的 rodio 只带 flac/mp3/ogg/m4a/wav;加密档(.mflac/.mgg)与 NAC 解不了
        for _, prefix, ext in LADDER:
            self.assertIn(ext, ("flac", "mp3", "ogg", "m4a"))
            self.assertNotIn("M0", prefix[2:], f"{prefix} 看着像加密档前缀")


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
