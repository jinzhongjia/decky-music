"""歌词:取 QQ 逐行 LRC(含翻译)→ 归一化到共享结构(见 src/api.ts Lyric)。

QQ 逐字(QRC)需特定权限,P3 先做逐行(word_by_word=False);逐字留后续升级。
归一化:{word_by_word, lines:[{t_ms, text, tr}]},tr 为该行译文(无则空)。
"""

import re

# LRC 时间标签 [mm:ss] / [mm:ss.xx] / [mm:ss.xxx];元数据标签([ti:]/[ar:] 等)不匹配 → 天然跳过
_TAG = re.compile(r"\[(\d+):(\d+)(?:\.(\d+))?\]")

# QQ LRC 用 "//" 作占位(主词的空行间隔、译文的"该行无翻译"),不是歌词内容,渲染出来即垃圾行
_JUNK = {"//", "/"}


def _parse_lrc(text: str) -> list[dict]:
    """LRC 文本 → [{t_ms, text}],按时间升序;一行多标签则拆成多行。无时间戳/空正文/占位行跳过。"""
    out: list[dict] = []
    for line in text.splitlines():
        tags = list(_TAG.finditer(line))
        if not tags:
            continue
        body = line[tags[-1].end() :].strip()
        if not body or body in _JUNK:
            continue
        for m in tags:
            mm, ss, frac = m.group(1), m.group(2), m.group(3)
            t = int(mm) * 60000 + int(ss) * 1000
            if frac:
                t += int((frac + "000")[:3])  # 补/截到毫秒:.5→500 .34→340 .345→345
            out.append({"t_ms": t, "text": body})
    out.sort(key=lambda x: x["t_ms"])
    return out


def _merge(main: list[dict], trans: list[dict]) -> list[dict]:
    """把逐行译文按行首时间对齐到主歌词(网易云/QQ 译文时间戳与原文一致)。"""
    tr = {x["t_ms"]: x["text"] for x in trans}
    return [{"t_ms": ln["t_ms"], "text": ln["text"], "tr": tr.get(ln["t_ms"], "")} for ln in main]


async def get_lyric(q, mid: str) -> dict:
    resp = await q.client.lyric.get_lyric(mid, trans=True)
    lines = _merge(_parse_lrc(resp.lyric or ""), _parse_lrc(resp.trans or ""))
    return {"word_by_word": False, "lines": lines}
