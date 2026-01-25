"""
歌词解析器单元测试
"""

import sys
from pathlib import Path

# Save current directory and temporarily remove it from path to avoid types.py conflict
cwd = str(Path.cwd())
backend_path = Path(__file__).parent

# Ensure backend is NOT in sys.path when importing unittest
if str(backend_path) in sys.path:
    sys.path.remove(str(backend_path))
if cwd in sys.path:
    sys.path.remove(cwd)

# Now safe to import unittest (won't hit backend/types.py)
import unittest

# NOW add backend to path and import lyric_parser
sys.path.insert(0, str(backend_path))
from lyric_parser import parse_lyric, parse_time, is_invalid_lyric_text, is_qrc_format


class TestLyricParser(unittest.TestCase):
    """歌词解析器测试套件"""

    def test_parse_time_standard(self):
        """测试标准时间格式解析"""
        self.assertEqual(parse_time("00:00.00"), 0)
        self.assertEqual(parse_time("01:30.50"), 90500)
        self.assertEqual(parse_time("02:45.123"), 165123)
        self.assertEqual(parse_time("10:00.00"), 600000)

    def test_parse_time_colon_separator(self):
        """测试冒号分隔符格式"""
        self.assertEqual(parse_time("00:00:00"), 0)
        self.assertEqual(parse_time("01:30:50"), 90500)

    def test_parse_time_two_digit_ms(self):
        """测试两位数毫秒的补齐"""
        self.assertEqual(parse_time("00:00.10"), 100)  # 10 -> 100
        self.assertEqual(parse_time("00:00.99"), 990)  # 99 -> 990

    def test_parse_time_invalid(self):
        """测试无效时间格式"""
        self.assertEqual(parse_time("invalid"), -1)
        self.assertEqual(parse_time(""), -1)
        self.assertEqual(parse_time("abc:def"), -1)

    def test_is_invalid_lyric_text(self):
        """测试无效歌词文本识别"""
        # 纯符号
        self.assertTrue(is_invalid_lyric_text("---"))
        self.assertTrue(is_invalid_lyric_text("..."))
        self.assertTrue(is_invalid_lyric_text("  "))
        self.assertTrue(is_invalid_lyric_text(""))

        # 坐标标记
        self.assertTrue(is_invalid_lyric_text("(1062,531)"))
        self.assertTrue(is_invalid_lyric_text("(100)"))

        # 有效文本
        self.assertFalse(is_invalid_lyric_text("Hello World"))
        self.assertFalse(is_invalid_lyric_text("歌词内容"))

    def test_is_qrc_format(self):
        """测试 QRC 格式检测"""
        qrc_lyric = "[0,2000]Hello(100,200)World(300,400)"
        lrc_lyric = "[00:00.00]Hello World"

        self.assertTrue(is_qrc_format(qrc_lyric))
        self.assertFalse(is_qrc_format(lrc_lyric))
        self.assertFalse(is_qrc_format(""))

    def test_parse_lrc_basic(self):
        """测试基本 LRC 格式解析"""
        lrc = """[00:00.50]第一句歌词
[00:05.00]第二句歌词
[00:10.00]第三句歌词"""

        result = parse_lyric(lrc)

        self.assertFalse(result["isQrc"])
        self.assertEqual(len(result["lines"]), 3)
        self.assertEqual(result["lines"][0]["time"], 500)
        self.assertEqual(result["lines"][0]["text"], "第一句歌词")
        self.assertEqual(result["lines"][1]["time"], 5000)
        self.assertEqual(result["lines"][2]["time"], 10000)

    def test_parse_lrc_with_translation(self):
        """测试带翻译的 LRC 解析"""
        lrc = """[00:00.50]你好世界
[00:05.00]再见世界"""
        trans = """[00:00.50]Hello World
[00:05.00]Goodbye World"""

        result = parse_lyric(lrc, trans)

        self.assertEqual(len(result["lines"]), 2)
        self.assertEqual(result["lines"][0]["text"], "你好世界")
        self.assertEqual(result["lines"][0].get("trans"), "Hello World")
        self.assertEqual(result["lines"][1].get("trans"), "Goodbye World")

    def test_parse_lrc_multiple_time_tags(self):
        """测试多时间标签（合唱）"""
        lrc = "[00:10.00][01:10.00][02:10.00]副歌部分"

        result = parse_lyric(lrc)

        self.assertEqual(len(result["lines"]), 3)
        self.assertEqual(result["lines"][0]["time"], 10000)
        self.assertEqual(result["lines"][1]["time"], 70000)
        self.assertEqual(result["lines"][2]["time"], 130000)
        self.assertEqual(result["lines"][0]["text"], "副歌部分")

    def test_parse_lrc_filter_invalid(self):
        """测试过滤无效行"""
        lrc = """[00:00.00]正常歌词
[00:01.00]---
[00:02.00]
[00:03.00](1062,531)
[00:04.00]另一句正常歌词"""

        result = parse_lyric(lrc)

        # 只有2行有效歌词
        self.assertEqual(len(result["lines"]), 2)
        self.assertEqual(result["lines"][0]["text"], "正常歌词")
        self.assertEqual(result["lines"][1]["text"], "另一句正常歌词")

    def test_parse_qrc_basic(self):
        """测试基本 QRC 格式解析"""
        qrc = """[0,2000]你(0,500)好(500,500)世(1000,500)界(1500,500)
[2000,2000]再(2000,500)见(2500,500)"""

        result = parse_lyric(qrc)

        self.assertTrue(result["isQrc"])
        self.assertIn("qrcLines", result)
        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        self.assertEqual(len(qrc_lines), 2)

        first_line = qrc_lines[0]
        self.assertEqual(first_line["time"], 0)
        self.assertEqual(first_line["text"], "你好世界")
        self.assertEqual(len(first_line["words"]), 4)
        self.assertEqual(first_line["words"][0]["text"], "你")
        self.assertEqual(first_line["words"][0]["start"], 0)
        self.assertEqual(first_line["words"][0]["duration"], 0.5)

    def test_parse_qrc_with_translation(self):
        """测试 QRC 格式带翻译"""
        qrc = "[0,2000]你(0,500)好(500,500)"
        trans = "[00:00.00]Hello"

        result = parse_lyric(qrc, trans)

        self.assertTrue(result["isQrc"])
        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        self.assertEqual(qrc_lines[0].get("trans"), "Hello")

    def test_parse_qrc_netease_yrc_format(self):
        """测试网易云 YRC 格式（三个参数）"""
        qrc = "[0,2000,0]歌(0,500,0)词(500,500,0)"

        result = parse_lyric(qrc)

        self.assertTrue(result["isQrc"])
        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        self.assertEqual(len(qrc_lines), 1)
        self.assertEqual(qrc_lines[0]["text"], "歌词")

    def test_parse_qrc_no_word_timing(self):
        """测试 QRC 格式但没有逐字时间标记"""
        qrc = "[0,2000]整行歌词没有逐字标记"

        result = parse_lyric(qrc)

        self.assertTrue(result["isQrc"])
        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        self.assertEqual(len(qrc_lines), 1)
        self.assertEqual(qrc_lines[0]["text"], "整行歌词没有逐字标记")
        self.assertEqual(len(qrc_lines[0]["words"]), 1)

    def test_parse_qrc_filter_metadata(self):
        """测试 QRC 过滤元数据行"""
        qrc = """[0,1000]Song Title - Artist Name
[60000,2000]正(60000,500)常(60500,500)歌(61000,500)词(61500,500)
[62000,2000]作词：张三
[64000,2000]另(64000,500)一(64500,500)句(65000,500)"""

        result = parse_lyric(qrc)

        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        self.assertEqual(len(qrc_lines), 2)
        self.assertEqual(qrc_lines[0]["text"], "正常歌词")
        self.assertEqual(qrc_lines[1]["text"], "另一句")

    def test_parse_empty_lyric(self):
        """测试空歌词"""
        result = parse_lyric("")

        self.assertEqual(len(result["lines"]), 0)
        self.assertFalse(result["isQrc"])

    def test_parse_qrc_generates_lrc_fallback(self):
        """测试 QRC 格式同时生成 LRC 回退"""
        qrc = "[0,2000]歌(0,500)词(500,500)"

        result = parse_lyric(qrc)

        self.assertTrue(result["isQrc"])
        # 应该同时有 lines 和 qrcLines
        self.assertIn("lines", result)
        self.assertIn("qrcLines", result)
        self.assertEqual(len(result["lines"]), 1)
        self.assertEqual(result["lines"][0]["text"], "歌词")
        self.assertEqual(result["lines"][0]["time"], 0)

    def test_parse_lrc_bom_and_crlf(self):
        """测试 BOM 和 CRLF 处理"""
        lrc = "\ufeff[00:00.00]测试歌词\r\n[00:05.00]第二句\r\n"

        result = parse_lyric(lrc)

        self.assertEqual(len(result["lines"]), 2)
        self.assertEqual(result["lines"][0]["text"], "测试歌词")

    def test_parse_qrc_invalid_duration_fallback(self):
        """测试 QRC 无效 duration 的回退处理"""
        qrc = "[0,2000]歌(0,0)词(invalid,invalid)"

        result = parse_lyric(qrc)

        self.assertTrue(result["isQrc"])
        qrc_lines = result.get("qrcLines")
        assert qrc_lines is not None
        word = qrc_lines[0]["words"][0]
        self.assertEqual(word["duration"], 0.1)


if __name__ == "__main__":
    unittest.main()
