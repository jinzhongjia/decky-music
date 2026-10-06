"""歌词:取 QQ 逐行 LRC(含翻译)→ 归一化到共享结构(见 src/api.ts Lyric)。

QQ 逐字(QRC)需特定权限,先做逐行(word_by_word=False);逐字留后续升级。
归一化:{word_by_word, lines:[{t_ms, end_ms?, text, tr}]},tr 为该行译文(无则空)。
解析规则与 ncm-provider/src/lyric/parse.rs 保持一致:
- 时间标签只认行首连续的 [mm:ss] / [mm:ss.f…] / [mm:ss:f…](小数取前三位作毫秒);
- 空正文与占位行(//、纯标点)是间奏标记:不输出,只用来给上一行定 end_ms;
- 译文按行首时间就近对齐(容差 ALIGN_TOLERANCE_MS),占位译文视为「此行无翻译」;
- 没有独立译文时,同时间戳的「原文 + 译文」双行合并(含冒号的制作人员 / 对唱行不合并)。
"""

import re

# 行首时间标签;元数据标签([ti:]/[ar:] 等)不匹配 → 天然跳过
_TAG = re.compile(r"\[(\d+):(\d+)(?:[.:](\d+))?\]", re.ASCII)

# 占位字符:QQ 用 "//" 作主词空行间隔与译文「该行无翻译」,也有整行 "......" 的
_PLACEHOLDER = set("/\\_-—~～·•….。")

# 译文行首与主歌词行首的最大允许偏差(毫秒)
ALIGN_TOLERANCE_MS = 300


def _is_placeholder(text: str) -> bool:
    return all(c.isspace() or c in _PLACEHOLDER for c in text)


def _tag_ms(m: re.Match) -> int:
    mm, ss, frac = m.groups()
    return int(mm) * 60000 + int(ss) * 1000 + int(((frac or "") + "000")[:3])


def _entries(text: str) -> list[tuple[int, str]]:
    """LRC → [(t_ms, 正文)],按时间稳定排序(同时间戳原文在前);一行多标签拆多条。

    正文为空或是占位时记为 "",作为间奏标记保留。
    """
    out: list[tuple[int, str]] = []
    for raw in text.splitlines():
        rest, times = raw.lstrip("\ufeff \t"), []
        while m := _TAG.match(rest):
            times.append(_tag_ms(m))
            rest = rest[m.end() :]
        body = rest.strip()
        body = "" if _is_placeholder(body) else body
        out.extend((t, body) for t in times)
    out.sort(key=lambda e: e[0])
    return out


def _has_colon(text: str) -> bool:
    return ":" in text or "：" in text


def _merge_embedded(lines: list[dict], t_ms: int, text: str) -> bool:
    """同时间戳的第二行并为上一行的译文;含冒号的(「作词:xx」「男:」)与重复行不合并。"""
    prev = lines[-1] if lines else None
    ok = (
        prev is not None
        and prev["t_ms"] == t_ms
        and not prev["tr"]
        and prev["text"] != text
        and not _has_colon(prev["text"])
        and not _has_colon(text)
    )
    if ok:
        prev["tr"] = text
    return ok


def _parse_lrc(text: str, merge_embedded: bool = False) -> list[dict]:
    """LRC → [{t_ms, end_ms?, text, tr}];end_ms 取下一个时间点(含间奏标记),末行未知则缺省。

    merge_embedded:合并同时间戳「原文 + 译文」(仅在没有独立译文时开启)。
    """
    entries = _entries(text)
    out: list[dict] = []
    for i, (t, body) in enumerate(entries):
        if not body or (merge_embedded and _merge_embedded(out, t, body)):
            continue
        line = {"t_ms": t, "text": body, "tr": ""}
        end = next((n for n, _ in entries[i + 1 :] if n > t), None)
        if end is not None:
            line["end_ms"] = end
        out.append(line)
    return out


def _closer(xs: list[dict], k: int, anchor: int, d: int) -> bool:
    """相邻候选 xs[k] 是否比当前配对(偏差 d)离 anchor 更近。"""
    return k < len(xs) and abs(xs[k]["t_ms"] - anchor) < abs(d)


def _align_translation(lines: list[dict], trans: list[dict]) -> None:
    """译文按行首时间就近对齐到主歌词(两边已排序;双指针 + 容差),原地写 tr。

    相邻行更近时把这一对让给它,避免密集行错配;已有译文的行不覆盖。
    """
    i = j = 0
    while i < len(lines) and j < len(trans):
        d = lines[i]["t_ms"] - trans[j]["t_ms"]
        if abs(d) > ALIGN_TOLERANCE_MS:
            i, j = (i + 1, j) if d < 0 else (i, j + 1)
        elif _closer(lines, i + 1, trans[j]["t_ms"], d):
            i += 1
        elif _closer(trans, j + 1, lines[i]["t_ms"], d):
            j += 1
        else:
            if not lines[i]["tr"]:
                lines[i]["tr"] = trans[j]["text"]
            i, j = i + 1, j + 1


async def get_lyric(q, mid: str) -> dict:
    resp = await q.client.lyric.get_lyric(mid, trans=True)
    trans = _parse_lrc(resp.trans or "")
    lines = _parse_lrc(resp.lyric or "", merge_embedded=not trans)
    _align_translation(lines, trans)
    return {"word_by_word": False, "lines": lines}
