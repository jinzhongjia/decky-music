"""qq-provider 歌词解析单测。

运行:(cd qq-provider && uv run python -m unittest discover tests)
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qq.lyric import _merge, _parse_lrc  # noqa: E402


class TestParseLrc(unittest.TestCase):
    def test_times_and_skip_meta(self):
        lines = _parse_lrc("[ti:x]\n[00:01.00]hello\n[00:02.5]world\n[00:03.345]!")
        self.assertEqual([ln["t_ms"] for ln in lines], [1000, 2500, 3345])
        self.assertEqual(lines[0]["text"], "hello")

    def test_multi_tag_line(self):
        lines = _parse_lrc("[00:01.00][00:05.00]repeat")
        self.assertEqual([ln["t_ms"] for ln in lines], [1000, 5000])

    def test_blank_and_untimed_dropped(self):
        self.assertEqual(_parse_lrc("no timestamp\n[00:01.00]\n"), [])


class TestMerge(unittest.TestCase):
    def test_align_translation(self):
        merged = _merge(_parse_lrc("[00:01.00]hello"), _parse_lrc("[00:01.00]你好"))
        self.assertEqual(merged[0]["tr"], "你好")

    def test_missing_translation_empty(self):
        merged = _merge(_parse_lrc("[00:01.00]hello"), [])
        self.assertEqual(merged[0]["tr"], "")


if __name__ == "__main__":
    unittest.main()


class TestJunkFilter(unittest.TestCase):
    def test_slash_placeholder_lines_dropped(self):
        # QQ 用 "//" 占位(空行间隔/无翻译);不是歌词,渲染即垃圾行
        raw = "[00:01.00]Written by: X\n[00:02.00]//\n[00:03.00]real lyric\n[00:04.00]/"
        lines = _parse_lrc(raw)
        self.assertEqual([x["text"] for x in lines], ["Written by: X", "real lyric"])

    def test_slash_translation_becomes_empty(self):
        main = _parse_lrc("[00:01.00]hello\n[00:02.00]world")
        trans = _parse_lrc("[00:01.00]你好\n[00:02.00]//")
        merged = _merge(main, trans)
        self.assertEqual(merged[0]["tr"], "你好")
        self.assertEqual(merged[1]["tr"], "")  # "//" 译文按无翻译处理
