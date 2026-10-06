"""qq-provider 歌词解析单测(规则与 ncm-provider/src/lyric/tests.rs 对应)。

运行:(cd qq-provider && uv run python -m unittest discover tests)
"""

import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qq.lyric import _align_translation, _parse_lrc, get_lyric  # noqa: E402

# 与 ncm-provider/src/lyric/tests.rs 共用的逐行 LRC 用例(仓库根 tests/fixtures/)
_SHARED_CASES = os.path.join(
    os.path.dirname(__file__), "..", "..", "tests", "fixtures", "lyric_lrc_cases.json"
)


def _times(lines):
    return [ln["t_ms"] for ln in lines]


def _texts(lines):
    return [ln["text"] for ln in lines]


def _trs(lines):
    return [ln["tr"] for ln in lines]


def _run_get_lyric(lyric, trans):
    resp = SimpleNamespace(lyric=lyric, trans=trans)

    async def fake(mid, **kwargs):
        return resp

    q = SimpleNamespace(client=SimpleNamespace(lyric=SimpleNamespace(get_lyric=fake)))
    return asyncio.run(get_lyric(q, "mid"))


class TestParseLrc(unittest.TestCase):
    def test_times_and_skip_meta(self):
        lines = _parse_lrc("[ti:x]\n[00:01.00]hello\n[00:02.5]world\n[00:03.345]!")
        self.assertEqual(_times(lines), [1000, 2500, 3345])
        self.assertEqual(lines[0]["text"], "hello")

    def test_multi_tag_line(self):
        self.assertEqual(_times(_parse_lrc("[00:01.00][00:05.00]repeat")), [1000, 5000])

    def test_blank_and_untimed_dropped(self):
        self.assertEqual(_parse_lrc("no timestamp\n[00:01.00]\n"), [])

    def test_time_tag_variants(self):
        # 无小数、冒号分隔厘秒、超过三位小数;非法标签整行跳过
        lines = _parse_lrc("[00:12]a\n[00:13:96]b\n[00:14.3456]c\n[0x:15.00]bad")
        self.assertEqual(_times(lines), [12000, 13960, 14345])
        self.assertEqual(_texts(lines), ["a", "b", "c"])

    def test_only_leading_tags_count(self):
        lines = _parse_lrc("[00:01.00]see [00:02.00] here")
        self.assertEqual(_times(lines), [1000])
        self.assertEqual(lines[0]["text"], "see [00:02.00] here")

    def test_bom_and_crlf(self):
        lines = _parse_lrc("\ufeff[00:01.00]first\r\n[00:02.00]second\r\n")
        self.assertEqual(_texts(lines), ["first", "second"])


class TestPlaceholderAndEnd(unittest.TestCase):
    def test_slash_placeholder_lines_dropped(self):
        # QQ 用 "//" 占位(空行间隔/无翻译);不是歌词,渲染即垃圾行
        raw = "[00:01.00]Written by: X\n[00:02.00]//\n[00:03.00]real lyric\n[00:04.00]/"
        self.assertEqual(_texts(_parse_lrc(raw)), ["Written by: X", "real lyric"])

    def test_interlude_markers_set_end(self):
        lines = _parse_lrc("[00:01.00]a\n[00:03.00]\n[00:05.00]//\n[00:20.00]b")
        self.assertEqual(_texts(lines), ["a", "b"])
        self.assertEqual(lines[0]["end_ms"], 3000)
        self.assertNotIn("end_ms", lines[1])  # 末行结束时间未知

    def test_end_is_next_distinct_time(self):
        lines = _parse_lrc("[00:01.00]a\n[00:01.00]b\n[00:04.00]c")
        self.assertEqual([lines[0]["end_ms"], lines[1]["end_ms"]], [4000, 4000])


class TestEmbeddedTranslation(unittest.TestCase):
    def test_merges_same_timestamp_pair(self):
        raw = "[00:01.00]Hello\n[00:01.00]你好\n[00:03.00]Bye\n[00:03.00]再见"
        lines = _parse_lrc(raw, merge_embedded=True)
        self.assertEqual(_texts(lines), ["Hello", "Bye"])
        self.assertEqual(_trs(lines), ["你好", "再见"])
        self.assertEqual(lines[0]["end_ms"], 3000)

    def test_credits_and_duplicates_not_merged(self):
        raw = "[00:00.00]作词：甲\n[00:00.00]作曲：乙\n[00:05.00]la\n[00:05.00]la"
        lines = _parse_lrc(raw, merge_embedded=True)
        self.assertEqual(_texts(lines), ["作词：甲", "作曲：乙", "la", "la"])
        self.assertEqual(_trs(lines), ["", "", "", ""])


class TestAlign(unittest.TestCase):
    def _align(self, main, trans):
        lines = _parse_lrc(main)
        _align_translation(lines, _parse_lrc(trans))
        return _trs(lines)

    def test_align_translation(self):
        self.assertEqual(self._align("[00:01.00]hello", "[00:01.00]你好"), ["你好"])

    def test_missing_translation_empty(self):
        self.assertEqual(self._align("[00:01.00]hello", ""), [""])

    def test_tolerates_precision_drift(self):
        self.assertEqual(self._align("[00:12.345]hello", "[00:12.34]你好"), ["你好"])

    def test_prefers_nearest_line(self):
        self.assertEqual(self._align("[00:01.00]a\n[00:01.20]b", "[00:01.20]乙"), ["", "乙"])

    def test_placeholder_and_out_of_range(self):
        main = "[00:01.00]hello\n[00:02.00]world\n[00:05.00]far"
        trans = "[00:01.00]你好\n[00:02.00]......\n[00:05.50]远"
        self.assertEqual(self._align(main, trans), ["你好", "", ""])

    def test_keeps_existing_translation(self):
        lines = _parse_lrc("[00:01.00]Hello\n[00:01.00]你好", merge_embedded=True)
        _align_translation(lines, _parse_lrc("[00:01.00]哈喽"))
        self.assertEqual(_trs(lines), ["你好"])


class TestGetLyric(unittest.TestCase):
    def test_embedded_merge_only_without_external_translation(self):
        raw = "[00:01.00]Hello\n[00:01.00]你好"
        merged = _run_get_lyric(raw, None)
        self.assertEqual(merged["word_by_word"], False)
        self.assertEqual(_trs(merged["lines"]), ["你好"])
        kept = _run_get_lyric(raw, "[00:01.00]哈喽")
        self.assertEqual(_texts(kept["lines"]), ["Hello", "你好"])
        self.assertEqual(kept["lines"][0]["tr"], "哈喽")

    def test_missing_text_gives_empty_lyric(self):
        self.assertEqual(_run_get_lyric(None, None), {"word_by_word": False, "lines": []})

    def test_shared_lrc_cases(self):
        """与 NCM 端同一份用例:逐行 LRC + 译文的归一化输出必须逐行一致。"""
        with open(_SHARED_CASES, encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        self.assertTrue(cases)
        for case in cases:
            with self.subTest(case["name"]):
                out = _run_get_lyric(case["lrc"], case["trans"])
                self.assertEqual(out["lines"], case["lines"])


if __name__ == "__main__":
    unittest.main()
