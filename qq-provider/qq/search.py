"""搜索 + 歌曲归一化(映射到共享 Song 形状,见 src/api.ts)。"""


async def search(q, keyword: str, limit: int = 20) -> list[dict]:
    resp = await q.client.search.general_search(keyword, num=limit)
    items = getattr(getattr(resp, "song", None), "items", None) or []
    return [_song_brief(s) for s in items]


def _song_brief(s) -> dict:
    singers = " / ".join(getattr(x, "name", "") for x in (getattr(s, "singer", None) or []))
    album = getattr(s, "album", None)
    album_mid = getattr(album, "mid", "") or ""
    # QQ 封面无直链,由专辑 mid 拼 CDN 模板(300x300)
    cover = f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else ""
    return {
        "mid": s.mid,
        "name": getattr(s, "name", ""),
        "singer": singers,
        "album": getattr(album, "name", "") or "",
        "duration": int(getattr(s, "interval", 0) or 0),  # QQ interval 单位为秒
        "cover": cover,
        "vip": bool(getattr(getattr(s, "pay", None), "pay_play", 0)),
        "media_mid": getattr(getattr(s, "file", None), "media_mid", "") or "",
    }
