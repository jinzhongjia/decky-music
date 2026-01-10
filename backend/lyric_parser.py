"""
歌词解析器 - 支持 LRC 和 QRC (卡拉OK) 格式
从 TypeScript src/utils/lyricParser.ts 迁移而来
"""

import re
from typing import TypedDict, NotRequired


class LyricWord(TypedDict):
    """QRC 格式的逐字信息"""

    text: str
    start: float  # 开始时间（秒）
    duration: float  # 持续时间（秒）


class LyricLine(TypedDict):
    """LRC 格式的歌词行"""

    time: int  # 毫秒
    text: str  # 原文
    trans: NotRequired[str]  # 翻译


class QrcLyricLine(TypedDict):
    """QRC 格式的歌词行（带逐字时间）"""

    time: float  # 行开始时间（秒）
    words: list[LyricWord]  # 逐字数组
    text: str  # 完整文本（用于回退显示）
    trans: NotRequired[str]  # 翻译


class ParsedLyric(TypedDict):
    """解析后的歌词"""

    lines: list[LyricLine]  # LRC 格式行
    qrcLines: NotRequired[list[QrcLyricLine]]  # QRC 格式行（如果有）
    isQrc: bool  # 是否是 QRC 格式


# 清理非标准时间标记的正则
CLEANUP_TIME_MARKER_REGEX = re.compile(r"\(\d+(?:,\d+)*\)")


def parse_time(time_str: str) -> int:
    """
    解析时间标签 [mm:ss.xx] 或 [mm:ss:xx] 或 [mm:ss]
    返回毫秒数，解析失败返回 -1
    """
    match = re.match(r"(\d+):(\d+)(?:[.:](\d+))?", time_str)
    if not match:
        return -1

    minutes = int(match.group(1))
    seconds = int(match.group(2))
    milliseconds = 0

    if match.group(3):
        ms_str = match.group(3)
        milliseconds = int(ms_str)
        # 如果是两位数，补齐到三位（10 -> 100）
        if len(ms_str) == 2:
            milliseconds *= 10

    return minutes * 60 * 1000 + seconds * 1000 + milliseconds


def is_invalid_lyric_text(text: str) -> bool:
    """检查是否是无效的歌词文本（纯符号、间奏标记等）"""
    trimmed = text.strip()
    # 过滤纯符号、空行
    if not trimmed or re.match(r"^[/\-*~\s\\：:.。，,]+$", trimmed):
        return True
    # 过滤纯坐标/时间标记行，如 (1062,531)
    if re.match(r"^\(\d+(?:,\d+)*\)$", trimmed):
        return True
    return False


def parse_lrc(lrc: str) -> dict[int, str]:
    """解析完整 LRC 歌词"""
    result: dict[int, str] = {}
    if not lrc or not isinstance(lrc, str):
        return result

    # 清理 BOM 和回车符
    cleaned = lrc.replace("\ufeff", "").replace("\r", "")
    time_tag_regex = re.compile(r"\[(\d+:\d+(?:[.:]\d+)?)\]")

    for line in cleaned.split("\n"):
        trimmed_line = line.rstrip()
        if not trimmed_line:
            continue

        # 提取所有时间标签
        times: list[int] = []
        for match in time_tag_regex.finditer(trimmed_line):
            time_ms = parse_time(match.group(1))
            if time_ms >= 0:
                times.append(time_ms)

        # 移除时间标签，获取文本
        text = re.sub(r"\[\d+:\d+(?:[.:]\d+)?\]", "", trimmed_line).strip()
        if text and not is_invalid_lyric_text(text):
            for time in times:
                result[time] = text

    return result


def build_lrc_lines(lyric_map: dict[int, str], trans_map: dict[int, str]) -> list[LyricLine]:
    """将 LRC Map 转换为 LyricLine 数组"""
    all_times = set(lyric_map.keys()) | set(trans_map.keys())
    sorted_times = sorted(all_times)

    lines: list[LyricLine] = []
    for time in sorted_times:
        text = lyric_map.get(time, "")
        if text:
            line: LyricLine = {"time": time, "text": text}
            trans = trans_map.get(time)
            if trans:
                line["trans"] = trans
            lines.append(line)

    return lines


def is_qrc_format(lyric: str) -> bool:
    """
    检测是否是 QRC 格式歌词
    QRC 格式特征：[lineStart,lineDuration]word(start,duration)...
    """
    trimmed = lyric.strip()
    if not trimmed:
        return False

    # 检查前30行是否有 QRC 格式的行首 [数字,数字]
    lines = trimmed.split("\n")[:30]
    return any(re.match(r"^\[\d+,\d+", line.strip()) for line in lines)


def parse_qrc(qrc: str) -> list[QrcLyricLine]:
    """
    解析 QRC 格式歌词
    支持 QQ 音乐和网易云 YRC 格式
    """
    result: list[QrcLyricLine] = []
    if not qrc or not isinstance(qrc, str):
        return result

    cleaned = qrc.replace("\ufeff", "").replace("\r", "")
    # 支持 QQ 音乐 (数字,数字) 和 网易云 YRC (数字,数字,数字)
    time_marker_regex = re.compile(r"\((\d+),(\d+)(?:,\d+)?\)")

    for line in cleaned.split("\n"):
        trimmed_line = line.rstrip()
        if not trimmed_line:
            continue

        # 匹配行首格式：[数字,数字] 或 [数字,数字,其他]
        line_match = re.match(r"^\[(\d+),(\d+)(?:,.*?)?\](.+)$", trimmed_line)
        if not line_match:
            continue

        line_start = int(line_match.group(1))
        if line_start < 0:
            continue

        content = line_match.group(3)
        words: list[LyricWord] = []
        full_text = ""

        # 收集所有时间标记
        markers: list[dict] = []
        for time_match in time_marker_regex.finditer(content):
            start = int(time_match.group(1))
            duration = int(time_match.group(2))
            if start >= 0:
                markers.append(
                    {
                        "index": time_match.start(),
                        "length": len(time_match.group(0)),
                        "start": start / 1000,
                        "duration": duration / 1000,
                        "is_valid": duration > 0,
                    }
                )

        # 提取文本并构建 words 数组
        last_end = 0
        last_valid_marker = None

        for marker in markers:
            text = content[last_end : marker["index"]]
            if text:
                word_start = (
                    marker["start"]
                    if marker["is_valid"]
                    else (
                        last_valid_marker["start"] + last_valid_marker["duration"]
                        if last_valid_marker
                        else line_start / 1000
                    )
                )
                word_duration = marker["duration"] if marker["is_valid"] else 0.1
                words.append({"text": text, "start": word_start, "duration": word_duration})
                full_text += text

            last_end = marker["index"] + marker["length"]
            if marker["is_valid"]:
                last_valid_marker = marker

        # 处理最后一个时间标记后的文本
        if last_end < len(content):
            remaining = CLEANUP_TIME_MARKER_REGEX.sub("", content[last_end:])
            if remaining.strip():
                start_time = (
                    last_valid_marker["start"] + last_valid_marker["duration"]
                    if last_valid_marker
                    else line_start / 1000
                )
                words.append({"text": remaining, "start": start_time, "duration": 0.1})
                full_text += remaining

        # 如果没有时间标记但有内容，整行作为一个词
        if not words and content.strip():
            cleaned_content = CLEANUP_TIME_MARKER_REGEX.sub("", content).strip()
            if cleaned_content:
                words.append({"text": cleaned_content, "start": line_start / 1000, "duration": 0.1})
                full_text = cleaned_content

        # 过滤无效行
        if words:
            clean_text = full_text.strip()
            is_interlude = re.match(r"^[/\-*~\s\\：:]+$", clean_text) or not clean_text
            is_meta_info = (
                re.match(
                    r"^(Writtenby|Composedby|Producedby|Arrangedby|作词|作曲|词|曲|编曲|制作|演唱|原唱|翻唱)[\s：:]",
                    clean_text,
                    re.IGNORECASE,
                )
                or re.search(r"[-–]\s*(Artist|Singer|Band|作词|作曲|编曲)", clean_text, re.IGNORECASE)
            )
            all_symbols = all(re.match(r"^[/\-*~\s\\：:.。，,()（）]+$", w["text"].strip()) for w in words)
            is_title_line = not result and " - " in clean_text and line_start < 60000

            if not is_interlude and not is_meta_info and not all_symbols and not is_title_line:
                result.append({"time": line_start / 1000, "words": words, "text": full_text})

    return sorted(result, key=lambda x: x["time"])


def parse_lyric(lyric: str, trans: str = "") -> ParsedLyric:
    """
    解析歌词（原文 + 翻译）
    自动检测 QRC 或 LRC 格式
    """
    if not lyric or not isinstance(lyric, str):
        return {"lines": [], "isQrc": False}

    trans_map = parse_lrc(trans) if trans else {}

    # 检测并尝试解析 QRC 格式
    if is_qrc_format(lyric):
        qrc_lines = parse_qrc(lyric)

        if qrc_lines:
            # 为 QRC 行添加翻译（时间差在 500ms 内匹配）
            for qrc_line in qrc_lines:
                line_time_ms = qrc_line["time"] * 1000
                for trans_time, trans_text in trans_map.items():
                    if abs(trans_time - line_time_ms) < 500 and not is_invalid_lyric_text(trans_text):
                        qrc_line["trans"] = trans_text
                        break

            # 同时生成 LRC 格式的 lines（用于回退）
            lines: list[LyricLine] = []
            for qrc_line in qrc_lines:
                line: LyricLine = {
                    "time": int(qrc_line["time"] * 1000),
                    "text": qrc_line["text"],
                }
                if "trans" in qrc_line:
                    line["trans"] = qrc_line["trans"]
                lines.append(line)

            return {"lines": lines, "qrcLines": qrc_lines, "isQrc": True}

    # LRC 格式解析
    lyric_map = parse_lrc(lyric)
    return {"lines": build_lrc_lines(lyric_map, trans_map), "isQrc": False}
